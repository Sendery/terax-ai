import { readFile, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import {
  defineTool,
  type AgentToolResult,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  isTeraxCommandId,
  TERAX_COMMAND_IDS,
  type TeraxCommandId,
} from "./commands.js";
import { TeraxClient } from "./client.js";
import {
  DEVELOPMENT_CAPABILITIES,
  getDevelopmentGuide,
  isDevelopmentCapability,
} from "./development.js";
import { discoverTerax } from "./discovery.js";
import {
  detectTeraxHost,
  teraxEnableInstructions,
  type HostEnv,
} from "./host.js";
import {
  assertVisualCaptureSafe,
  NATIVE_CAPTURE_TARGETS,
  runVisualQa,
  validateVisualQaRequest,
  type VisualBackend,
  type VisualQaRequest,
} from "./visual.js";
import {
  createNativeVisualBackend,
  type NativeVisualBackendOptions,
} from "./visual-native.js";
import { createSystemWindowsVisualBackend } from "./visual-windows.js";

type TextDetails = Record<string, unknown>;

function textResult(
  text: string,
  details: TextDetails = {},
): AgentToolResult<TextDetails> {
  return {
    content: [{ type: "text", text }],
    details,
  };
}

async function callTerax(
  command: TeraxCommandId,
  payload: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  const discovery = await discoverTerax();
  return new TeraxClient(discovery, { signal }).call(command, payload);
}

const getStateTool = defineTool({
  name: "terax_get_state",
  label: "Get Terax state",
  description:
    "Return a redacted snapshot of the running Terax window. Terminal text and private terminal details are never included.",
  parameters: Type.Object({}),
  async execute(_toolCallId, _params, signal) {
    const state = await callTerax("app.snapshot", undefined, signal);
    return textResult(JSON.stringify(state, null, 2), { state });
  },
});

const callTool = defineTool({
  name: "terax_call",
  label: "Call Terax",
  description:
    "Invoke an allowlisted Terax UI command on the running app using the first-party command registry. Call app.commands first to read every command's supported payload arguments (types, required fields, and enum values such as tab colors).",
  parameters: Type.Object({
    command: Type.Union(TERAX_COMMAND_IDS.map((id) => Type.Literal(id))),
    // A described object (not Type.Any) so host argument sanitizers forward
    // nested fields instead of collapsing an empty schema to null. Call
    // app.commands to read the exact fields and enum values per command.
    payload: Type.Optional(
      Type.Object(
        {},
        {
          additionalProperties: true,
          description:
            "Command arguments as an object. Call app.commands to read the supported fields, types, and enum values per command.",
        },
      ),
    ),
  }),
  async execute(_toolCallId, params, signal) {
    if (!isTeraxCommandId(params.command)) {
      throw new Error(`Command ${params.command} is not allowed`);
    }
    const result = await callTerax(params.command, params.payload, signal);
    return textResult(JSON.stringify(result, null, 2), {
      command: params.command,
      result,
    });
  },
});

const waitTool = defineTool({
  name: "terax_wait",
  label: "Wait",
  description:
    "Wait briefly before checking Terax state again. Use after commands that may update UI asynchronously.",
  parameters: Type.Object({
    milliseconds: Type.Number({ minimum: 0, maximum: 30_000 }),
  }),
  async execute(_toolCallId, params, signal) {
    const milliseconds =
      typeof params.milliseconds === "number" ? params.milliseconds : 0;
    const waitedMs = Math.max(0, Math.min(30_000, milliseconds));
    await sleep(waitedMs, undefined, { signal });
    return textResult(`Waited ${waitedMs} ms`, { waitedMs });
  },
});

const developmentGuideTool = defineTool({
  name: "terax_development_guide",
  label: "Terax development guide",
  description:
    "Return the current Terax contribution points, invariants, tests, and verification commands for a feature, window, setting, shortcut, or app command.",
  parameters: Type.Object({
    capability: Type.Union(
      DEVELOPMENT_CAPABILITIES.map((capability) => Type.Literal(capability)),
    ),
  }),
  async execute(_toolCallId, params) {
    if (!isDevelopmentCapability(params.capability)) {
      throw new Error(`Unsupported Terax capability ${params.capability}`);
    }
    const guide = getDevelopmentGuide(params.capability);
    return textResult(JSON.stringify(guide, null, 2), { guide });
  },
});

export type ExtensionDependencies = {
  discover: typeof discoverTerax;
  createClient: (discovery: Awaited<ReturnType<typeof discoverTerax>>, signal?: AbortSignal) => {
    call: (command: TeraxCommandId, payload?: unknown) => Promise<unknown>;
  };
  createVisualBackend: (signal?: AbortSignal) => Promise<VisualBackend>;
  createNativeBackend: (options: NativeVisualBackendOptions) => VisualBackend;
  runVisual: typeof runVisualQa;
  readEvidence: typeof readFile;
  /** Environment used to detect whether Pi runs inside a Terax terminal. */
  hostEnv: HostEnv;
  /** Platform used to build enable instructions when unavailable. */
  platform: string;
};

const defaultDependencies: ExtensionDependencies = {
  discover: discoverTerax,
  createClient: (discovery, signal) => new TeraxClient(discovery, { signal }),
  createVisualBackend: (signal) => createSystemWindowsVisualBackend({ signal }),
  createNativeBackend: createNativeVisualBackend,
  runVisual: runVisualQa,
  readEvidence: readFile,
  hostEnv: process.env,
  platform: process.platform,
};

function createSpeakTool(dependencies: ExtensionDependencies) {
  return defineTool({
    name: "terax_speak",
    label: "Speak through Terax",
    description:
      "Read a short text aloud on the user's machine with Terax's local speech engine. Returns as soon as playback starts, not when it ends. Use it for confirmations and requested summaries, never to dump logs or long output. Call terax_call with tts.voices to list voices and with tts.status to follow progress.",
    parameters: Type.Object({
      text: Type.String({
        minLength: 1,
        maxLength: 8192,
        description:
          "Plain prose to speak. Markup, code and ANSI noise are spoken literally or stripped, so write it as it should sound.",
      }),
      language: Type.Optional(
        Type.Union([Type.Literal("es-ES"), Type.Literal("en-US")], {
          description:
            "Language whose default voice profile should speak. Omit to use the user's preferred language.",
        }),
      ),
      voiceId: Type.Optional(
        Type.String({
          minLength: 1,
          description:
            "Voice profile id from tts.voices. Wins over language when both are given.",
        }),
      ),
    }),
    async execute(_toolCallId, params, signal) {
      const text = typeof params.text === "string" ? params.text.trim() : "";
      if (text.length === 0) {
        throw new Error("terax_speak requires text to speak");
      }
      const discovery = await dependencies.discover({ signal });
      const client = dependencies.createClient(discovery, signal);
      const result = await client.call("tts.speak", {
        text,
        ...(params.language === undefined ? {} : { language: params.language }),
        ...(params.voiceId === undefined ? {} : { voiceId: params.voiceId }),
      });
      return textResult(JSON.stringify(result, null, 2), { result });
    },
  });
}

function createStatusTool(dependencies: ExtensionDependencies) {
  return defineTool({
    name: "terax_status",
    label: "Terax status",
    description:
      "Report whether this Pi session runs inside a Terax terminal and which Pi-Terax capabilities are available. When unavailable, returns how to enable them.",
    parameters: Type.Object({}),
    async execute() {
      const host = detectTeraxHost(dependencies.hostEnv);
      const capabilities = host.available
        ? [
            "terax_get_state",
            "terax_call",
            "terax_speak",
            "terax_wait",
            "terax_development_guide",
            "terax_visual_qa",
          ]
        : [];
      const details = {
        available: host.available,
        inTerax: host.inTerax,
        forced: host.forced,
        host: {
          termProgram: host.termProgram ?? null,
          termProgramVersion: host.termProgramVersion ?? null,
        },
        capabilities,
        enable: host.available
          ? null
          : teraxEnableInstructions(dependencies.platform),
      };
      const text = host.available
        ? "Pi-Terax is available. Control and development tools are active."
        : `${details.enable?.reason}\nEnable: ${details.enable?.steps.join(" ")} (command: ${details.enable?.command}). Or set TERAX_FORCE=1 to operate against a reachable Terax from this shell.`;
      return textResult(text, details);
    },
  });
}

function createVisualQaTool(dependencies: ExtensionDependencies) {
  return defineTool({
  name: "terax_visual_qa",
  label: "Terax visual QA",
  description:
    "Capture a Terax screenshot, record a short MP4 with a PNG preview, or compare the current UI against a project baseline. Returns visual evidence for model inspection.",
  parameters: Type.Object({
    action: Type.Union([
      Type.Literal("screenshot"),
      Type.Literal("video"),
      Type.Literal("compare"),
    ]),
    surface: Type.Union([Type.Literal("main"), Type.Literal("settings")]),
    name: Type.String({ minLength: 1, maxLength: 80 }),
    target: Type.Optional(
      Type.Union(
        NATIVE_CAPTURE_TARGETS.map((target) => Type.Literal(target)),
      ),
    ),
    tabId: Type.Optional(Type.Integer({ minimum: 1 })),
    durationSeconds: Type.Optional(Type.Number({ minimum: 1, maximum: 30 })),
    fps: Type.Optional(Type.Integer({ minimum: 1, maximum: 30 })),
    baselinePath: Type.Optional(Type.String({ minLength: 1 })),
    threshold: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
  }),
  async execute(_toolCallId, params, signal, _onUpdate, ctx) {
    if (!ctx.isProjectTrusted()) {
      throw new Error("Visual QA requires a trusted Pi project");
    }
    const validated = validateVisualQaRequest(params as VisualQaRequest);
    const discovery = await dependencies.discover({ signal });
    const client = dependencies.createClient(discovery, signal);
    const guard = async () => {
      const snapshot = await client.call("app.snapshot", undefined);
      if (validated.surface === "main") assertVisualCaptureSafe(snapshot);
    };
    await guard();
    const backend =
      validated.surface === "main"
        ? dependencies.createNativeBackend({
            client: client as NativeVisualBackendOptions["client"],
            pid: discovery.pid,
            target: validated.target ?? "window",
            ...(validated.tabId === undefined ? {} : { tabId: validated.tabId }),
          })
        : await dependencies.createVisualBackend(signal);
    const result = await dependencies.runVisual(validated, {
      projectRoot: ctx.cwd,
      pid: discovery.pid,
      backend,
      guard,
      signal,
    });
    try {
      await guard();
      signal?.throwIfAborted();
      const image = await dependencies.readEvidence(result.imagePath);
      signal?.throwIfAborted();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
          {
            type: "image",
            data: image.toString("base64"),
            mimeType: "image/png",
          },
        ],
        details: result,
      };
    } catch (error) {
      await rm(dirname(result.reportPath), { recursive: true, force: true });
      throw error;
    }
  },
  });
}

function emitMonitorMarker(status: "working" | "finished"): void {
  process.stdout.write(`\x1b]777;notify;Terax;pi;${status}\x07`);
}

type AgentSettledExtensionAPI = {
  on(
    event: "agent_settled",
    handler: (event: unknown, ctx: ExtensionContext) => void,
  ): void;
};

function registerMonitorLifecycle(pi: ExtensionAPI): void {
  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode === "tui" && !ctx.isIdle()) emitMonitorMarker("working");
  });
  pi.on("agent_start", (_event, ctx) => {
    if (ctx.mode === "tui") emitMonitorMarker("working");
  });
  (pi as unknown as AgentSettledExtensionAPI).on(
    "agent_settled",
    (_event, ctx) => {
      if (ctx.mode === "tui" && ctx.isIdle()) emitMonitorMarker("finished");
    },
  );
}

export function createExtension(
  dependencies: ExtensionDependencies = defaultDependencies,
): (pi: ExtensionAPI) => void {
  return (pi: ExtensionAPI): void => {
    const host = detectTeraxHost(dependencies.hostEnv);

    // A single discovery entrypoint is always present so Pi can recognize the
    // integration and, when outside Terax, learn how to enable it.
    pi.registerTool(createStatusTool(dependencies));

    if (host.available) {
      registerMonitorLifecycle(pi);
      pi.registerTool(getStateTool);
      pi.registerTool(callTool);
      pi.registerTool(createSpeakTool(dependencies));
      pi.registerTool(waitTool);
      pi.registerTool(developmentGuideTool);
      pi.registerTool(createVisualQaTool(dependencies));
      return;
    }

    // Not in a Terax terminal: keep the footprint minimal and inform once at
    // session start instead of loading control/development context.
    if (typeof pi.on === "function" && typeof pi.sendMessage === "function") {
      const enable = teraxEnableInstructions(dependencies.platform);
      pi.on("session_start", () => {
        pi.sendMessage({
          customType: "terax-unavailable",
          content: `${enable.reason} Run \`terax_status\` for details. To enable: ${enable.steps.join(" ")} (command: ${enable.command}).`,
          display: true,
        } as never);
      });
    }
  };
}

export default createExtension();
