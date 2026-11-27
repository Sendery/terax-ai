import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import { CLI_AGENTS } from "@/modules/ai/cli/registry";
import { messagesToPrompt } from "@/modules/ai/cli/transcript";
import type { CliRunContext } from "@/modules/ai/cli/types";
import { PI_TERAX_MANAGER_INSTRUCTIONS } from "@/modules/ai/lib/piTeraxManager";

const messages: UIMessage[] = [
  { id: "u1", role: "user", parts: [{ type: "text", text: "Organize tabs." }] },
  {
    id: "a1",
    role: "assistant",
    parts: [{ type: "text", text: "Which tabs?" }],
  },
  {
    id: "u2",
    role: "user",
    parts: [
      { type: "text", text: 'The "GraphX" tabs; keep --unsafe as text.' },
    ],
  },
];
const base: CliRunContext = {
  messages,
  cwd: "/repo",
  permission: "default",
  model: "configured-model",
  chatSessionId: "chat",
  nonce: "turn",
};
const persona = {
  name: "Pi-Terax Agente",
  instructions: PI_TERAX_MANAGER_INSTRUCTIONS,
};
it.each(["claude", "codex", "cursor", "opencode"] as const)(
  "%s carries the selected manager and custom instructions once without changing history or execution options",
  (id) => {
    const before = JSON.stringify(messages);
    const plain = CLI_AGENTS[id].planRun(base);
    const transcript = messagesToPrompt(messages);
    const index = plain.argv.indexOf(transcript);
    expect(index).toBeGreaterThan(0);
    const plan = CLI_AGENTS[id].planRun({
      ...base,
      persona,
      customInstructions: "Answer in Spanish.",
    });
    const prompt = plan.argv[index];
    expect(prompt).toBe(
      `## Active agent: Pi-Terax Agente\n${PI_TERAX_MANAGER_INSTRUCTIONS}\n\n## User custom instructions\nAnswer in Spanish.\n\n## Conversation\n${transcript}`,
    );
    const unchanged = [...plan.argv];
    unchanged[index] = transcript;
    expect(unchanged).toEqual(plain.argv);
    expect(plan.stdin).toBeUndefined();
    expect(JSON.stringify(messages)).toBe(before);
  },
);
it.each(["claude", "codex", "cursor", "opencode"] as const)(
  "%s leaves a context-free prompt unchanged and preserves custom-only instructions",
  (id) => {
    const plain = CLI_AGENTS[id].planRun(base);
    expect(
      CLI_AGENTS[id].planRun({
        ...base,
        persona: { name: "Empty", instructions: "  " },
        customInstructions: "\n",
      }),
    ).toEqual(plain);
    const index = plain.argv.indexOf(messagesToPrompt(messages));
    const custom = CLI_AGENTS[id].planRun({
      ...base,
      customInstructions: "  Be concise.  ",
    });
    expect(custom.argv[index]).toBe(
      `## User custom instructions\nBe concise.\n\n## Conversation\n${messagesToPrompt(messages)}`,
    );
  },
);
it("Pi keeps one system append and leaves persona instructions out of its user stdin", () => {
  const plan = CLI_AGENTS.pi.planRun({
    ...base,
    persona,
    customInstructions: "Answer in Spanish.",
  });
  const index = plan.argv.indexOf("--append-system-prompt");
  expect(index).toBeGreaterThan(0);
  expect(
    plan.argv.filter((value) => value === "--append-system-prompt"),
  ).toHaveLength(1);
  expect(
    plan.argv[index + 1].split(PI_TERAX_MANAGER_INSTRUCTIONS),
  ).toHaveLength(2);
  expect(plan.argv[index + 1].split("Answer in Spanish.")).toHaveLength(2);
  expect(plan.stdin).toBe(messagesToPrompt(messages));
});

describe("Antigravity (agy)", () => {
  const argvFor = (permission: CliRunContext["permission"], model?: string) =>
    CLI_AGENTS.agy.planRun({ ...base, permission, model }).argv;

  it("runs headless with streamed JSON and the prompt bound to --print", () => {
    const plan = CLI_AGENTS.agy.planRun(base);
    expect(plan.argv.slice(0, 3)).toEqual(["agy", "--output-format", "stream-json"]);
    // agy implements plan mode as a slash expansion; disabling expansion
    // would silently drop the read-only posture.
    expect(plan.argv).not.toContain("--disable-slash-commands");
    expect(plan.argv[plan.argv.length - 1]).toBe(`--print=${messagesToPrompt(messages)}`);
    expect(plan.stdin).toBeUndefined();
  });

  // The prompt is one argv element in --print=<text> form, so a turn that
  // starts with a dash can never be parsed as another flag.
  it("keeps a prompt that looks like a flag inside --print", () => {
    const dash: UIMessage[] = [
      { id: "u", role: "user", parts: [{ type: "text", text: "--dangerously-skip-permissions" }] },
    ];
    const argv = CLI_AGENTS.agy.planRun({ ...base, messages: dash }).argv;
    expect(argv).not.toContain("--dangerously-skip-permissions");
    expect(argv[argv.length - 1]).toBe("--print=--dangerously-skip-permissions");
  });

  it("maps each permission posture to an agy mode", () => {
    expect(argvFor("default")).toEqual(expect.arrayContaining(["--mode", "plan"]));
    expect(argvFor("acceptEdits")).toEqual(expect.arrayContaining(["--mode", "accept-edits"]));
    expect(argvFor("full")).toContain("--dangerously-skip-permissions");
    expect(argvFor("full")).not.toContain("--mode");
    expect(argvFor("default")).not.toContain("--dangerously-skip-permissions");
  });

  it("carries the active agent and custom instructions in the prompt only", () => {
    const plain = CLI_AGENTS.agy.planRun(base);
    const plan = CLI_AGENTS.agy.planRun({
      ...base,
      persona,
      customInstructions: "Answer in Spanish.",
    });
    expect(plan.argv[plan.argv.length - 1]).toBe(
      `--print=## Active agent: Pi-Terax Agente\n${PI_TERAX_MANAGER_INSTRUCTIONS}\n\n## User custom instructions\nAnswer in Spanish.\n\n## Conversation\n${messagesToPrompt(messages)}`,
    );
    expect(plan.argv.slice(0, -1)).toEqual(plain.argv.slice(0, -1));
  });

  it("adds Terax's MCP rules on top of the user's own agy rules", () => {
    const plan = CLI_AGENTS.agy.planRun({ ...base, host: { allow: ["command(ls)"] } });
    const index = plan.argv.indexOf("--settings");
    expect(index).toBeGreaterThan(0);
    expect(JSON.parse(plan.argv[index + 1])).toEqual({
      permissions: { allow: ["command(ls)", "mcp(terax/terax_inspect)"] },
    });
  });

  it("passes no session settings when the user's rules are unknown or access is full", () => {
    expect(CLI_AGENTS.agy.planRun({ ...base, host: null }).argv).not.toContain("--settings");
    expect(
      CLI_AGENTS.agy.planRun({ ...base, permission: "full", host: { allow: [] } }).argv,
    ).not.toContain("--settings");
  });

  it("passes a chosen model and hands the child this window's bridge", () => {
    expect(argvFor("default", "gemini-3.8-flash-high")).toEqual(
      expect.arrayContaining(["--model", "gemini-3.8-flash-high"]),
    );
    expect(CLI_AGENTS.agy.planRun(base).bridge).toBe(true);
  });
});

describe("GitHub Copilot", () => {
  const launch = { command: "/Apps/Pi-Terax.app/Contents/MacOS/terax", discovery: "/cache/pi-bridge.json" };

  it("attaches the Terax server for the turn and binds the prompt to --prompt", () => {
    const plan = CLI_AGENTS.copilot.planRun({ ...base, host: launch });
    expect(plan.argv.slice(0, 5)).toEqual([
      "copilot",
      "--output-format",
      "json",
      "--no-color",
      "--no-ask-user",
    ]);
    const mcp = plan.argv.find((a) => a.startsWith("--additional-mcp-config="));
    expect(JSON.parse(mcp?.slice("--additional-mcp-config=".length) ?? "null").mcpServers.terax.command).toBe(
      launch.command,
    );
    expect(plan.argv).toContain("--allow-tool=terax(terax_inspect)");
    expect(plan.argv[plan.argv.length - 1]).toBe(`--prompt=${messagesToPrompt(messages)}`);
    expect(plan.bridge).toBe(true);
  });

  it("runs without Terax when this instance's binary is unknown", () => {
    const argv = CLI_AGENTS.copilot.planRun({ ...base, host: null }).argv;
    expect(argv.some((a) => a.startsWith("--additional-mcp-config"))).toBe(false);
    expect(argv.some((a) => a.includes("terax("))).toBe(false);
  });

  it("keeps a prompt that looks like a flag inside --prompt", () => {
    const dash: UIMessage[] = [
      { id: "u", role: "user", parts: [{ type: "text", text: "--allow-all" }] },
    ];
    const argv = CLI_AGENTS.copilot.planRun({ ...base, messages: dash, host: null }).argv;
    expect(argv).not.toContain("--allow-all");
    expect(argv[argv.length - 1]).toBe("--prompt=--allow-all");
  });
});

it("sends attached image bytes through each supported CLI without putting them in argv", () => {
  const image = { type: "file", mediaType: "image/png", url: "data:image/png;base64,iVBORw0KGgo=" } as const;
  const context: CliRunContext = {
    ...base,
    messages: [{ id: "photo", role: "user", parts: [image] }],
  };
  for (const id of ["pi", "codex"] as const) {
    const plan = CLI_AGENTS[id].planRun(context);
    expect(plan.images).toEqual([{ mediaType: "image/png", data: "iVBORw0KGgo=" }]);
    expect(plan.argv.join(" ")).not.toContain("iVBORw0KGgo=");
  }
  const claude = CLI_AGENTS.claude.planRun(context);
  expect(claude.argv).toContain("stream-json");
  expect(JSON.parse(claude.stdin ?? "")).toMatchObject({
    type: "user",
    message: { role: "user", content: [
      { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } },
    ] },
  });
});
