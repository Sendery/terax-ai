import type { ToolExecutionOptions } from "ai";
import { beforeEach, expect, it, vi } from "vitest";
import { useManagedAgentsStore } from "@/modules/agents/store/managedAgentsStore";
import type { ToolContext } from "@/modules/ai/tools/context";

vi.mock("@/modules/terminal", () => ({ writeToSession: vi.fn(() => true) }));
import { buildManagedAgentTools } from "@/modules/ai/tools/agent";

const options: ToolExecutionOptions = { toolCallId: "call", messages: [] };
function register(leafId = 2) {
  useManagedAgentsStore
    .getState()
    .register({
      leafId,
      tabId: 1,
      sessionId: "chat",
      task: "work",
      cwd: "/workspace",
    });
}
async function readOutput(
  read: ToolContext["readAgentOutput"],
  session: () => string | null = () => "chat",
) {
  const context: ToolContext = {
    getCwd: () => null,
    getWorkspaceRoot: () => null,
    getTerminalContext: () => null,
    isActiveTerminalPrivate: () => false,
    injectIntoActivePty: () => false,
    openPreview: () => false,
    spawnAgent: () => null,
    readAgentOutput: read,
    readCache: new Map(),
    getSessionId: session,
  };
  const execute = buildManagedAgentTools(context).read_agent_output.execute!;
  return execute({ lines: 2 }, options);
}

beforeEach(() => {
  useManagedAgentsStore.setState({ agents: {} });
  register();
});

it("awaits native output and uses the latest agent status", async () => {
  let finish!: (text: string) => void;
  const output = new Promise<string>((resolve) => {
    finish = resolve;
  });
  const result = readOutput(() => output);
  useManagedAgentsStore.getState().setPhase(2, "reviewing");
  finish("one\ntwo\nthree");
  expect(await result).toMatchObject({
    active: true,
    phase: "reviewing",
    output: "two\nthree",
  });
});

for (const change of ["removed", "replaced", "chat changed"] as const) {
  it(`withholds pending output after the agent is ${change}`, async () => {
    let finish!: (text: string) => void;
    let session = "chat";
    const output = new Promise<string>((resolve) => {
      finish = resolve;
    });
    const result = readOutput(
      () => output,
      () => session,
    );
    if (change === "chat changed") session = "other";
    else {
      useManagedAgentsStore.getState().remove(2);
      if (change === "replaced") register(4);
    }
    finish("withheld");
    expect(await result).toEqual({ active: false });
  });
}
