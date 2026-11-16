import type { UIMessage } from "ai";
import { expect, it } from "vitest";
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
