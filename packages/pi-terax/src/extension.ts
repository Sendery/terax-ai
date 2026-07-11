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
    "Invoke an allowlisted Terax UI command on the running app using the first-party command registry.",
  parameters: Type.Object({
    command: Type.Union(TERAX_COMMAND_IDS.map((id) => Type.Literal(id))),
    payload: Type.Optional(Type.Any()),
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

export default function extension(pi: ExtensionAPI): void {
  pi.registerTool(getStateTool);
  pi.registerTool(callTool);
  pi.registerTool(waitTool);
  pi.registerTool(developmentGuideTool);
}
