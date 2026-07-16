import { readFile, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import {
  defineTool,
  type AgentToolResult,
  type ExtensionAPI,
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
  runVisualQa,
  validateVisualQaRequest,
  type VisualBackend,
  type VisualQaRequest,
} from "./visual.js";
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
  runVisual: runVisualQa,
  readEvidence: readFile,
  hostEnv: process.env,
  platform: process.platform,
};

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
    const backend = await dependencies.createVisualBackend(signal);
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

export function createExtension(
  dependencies: ExtensionDependencies = defaultDependencies,
): (pi: ExtensionAPI) => void {
  return (pi: ExtensionAPI): void => {
    const host = detectTeraxHost(dependencies.hostEnv);

    // A single discovery entrypoint is always present so Pi can recognize the
    // integration and, when outside Terax, learn how to enable it.
    pi.registerTool(createStatusTool(dependencies));

    if (host.available) {
      pi.registerTool(getStateTool);
      pi.registerTool(callTool);
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
