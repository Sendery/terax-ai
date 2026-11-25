import { type ChunkEmitter, parseJsonLine, type CliParser } from "./emitter";

type Step = {
  step_index?: number;
  state?: string;
  step_type?: string;
  text_delta?: string;
  thinking_delta?: string;
  usage?: { total_tokens?: unknown };
  tool_name?: string;
  tool_info?: {
    name?: string;
    parameters?: unknown;
    output?: unknown;
    error?: { message?: string } | null;
  };
};

/**
 * Antigravity CLI `--print --output-format stream-json`. Every line is an
 * `{event, ...}` envelope: `init` once, `step_update` per step change and a
 * final `result`. Agent text streams as `text_delta` on `agent_response`
 * steps; a tool step goes ACTIVE (call) then DONE or ERROR (result).
 */
export function createAgyParser(emitter: ChunkEmitter): CliParser {
  const toolStarted = new Set<string>();
  const toolDone = new Set<string>();
  const countedSteps = new Set<string>();
  let conversationId: string | null = null;
  let textSeen = false;
  let failed = false;
  const fail = (message: string) => {
    if (failed) return;
    failed = true;
    emitter.error(message);
  };

  const toolId = (step: Step) => `${conversationId ?? "agy"}:${step.step_index ?? "x"}`;

  function onStep(step: Step): void {
    if (step.step_type === "agent_response") {
      const id = toolId(step);
      if (step.state === "DONE" && step.usage?.total_tokens !== undefined && !countedSteps.has(id)) {
        countedSteps.add(id);
        emitter.totalUsage(step.usage.total_tokens);
      }
      if (step.thinking_delta) emitter.reasoningDelta(step.thinking_delta);
      if (step.text_delta) {
        textSeen = true;
        emitter.textDelta(step.text_delta);
      }
      return;
    }
    if (step.step_type !== "tool") return;
    const id = toolId(step);
    const info = step.tool_info ?? {};
    if (!toolStarted.has(id)) {
      toolStarted.add(id);
      emitter.tool(id, info.name ?? step.tool_name ?? "tool", info.parameters ?? {});
    }
    if (toolDone.has(id)) return;
    if (step.state === "DONE") {
      toolDone.add(id);
      emitter.toolResult(id, info.output ?? null);
    } else if (step.state === "ERROR") {
      toolDone.add(id);
      emitter.toolResult(id, { error: info.error?.message ?? "Tool failed" });
    }
  }

  const onLine = (line: string) => {
    const obj = parseJsonLine(line);
    if (!obj) return;
    if (obj.event === "init") {
      const id = obj.conversation_id;
      if (typeof id === "string") {
        conversationId = id;
        emitter.metadata({ agy: { conversationId: id } });
      }
      return;
    }
    if (obj.event === "step_update") {
      const step = obj.step_update;
      if (step && typeof step === "object") onStep(step as Step);
      return;
    }
    if (obj.event === "result") {
      const result = (obj.result ?? {}) as Record<string, unknown>;
      // A turn can report ERROR after a retried request succeeded; only a turn
      // that produced nothing is a failure worth showing.
      if (!textSeen && typeof result.response === "string" && result.response.trim()) {
        textSeen = true;
        emitter.textDelta(result.response);
      }
      if (result.status !== "SUCCESS" && !textSeen) {
        fail(
          typeof result.error === "string" && result.error
            ? result.error
            : "Antigravity run failed",
        );
      }
    }
  };

  // Headless agy explains auto-denied permissions on stderr, and that is the
  // only clue when a turn ends empty.
  const denials: string[] = [];
  const onStderr = (line: string) => {
    const text = line.trim();
    if (text && denials.length < 3) denials.push(text);
  };
  // A null code is a run the user stopped: nothing to report.
  const onExit = (code: number | null) => {
    if (textSeen || code === null) return;
    if (denials.length > 0) fail(denials.join("\n"));
    else if (code !== 0) fail(`agy exited with code ${code}`);
  };

  return { onLine, onStderr, onExit };
}
