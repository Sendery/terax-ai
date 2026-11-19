import { type ChunkEmitter, parseJsonLine, type CliParser } from "./emitter";

type Data = Record<string, unknown>;

function resultText(result: unknown): unknown {
  if (result && typeof result === "object" && "content" in result) {
    return (result as { content: unknown }).content;
  }
  return result ?? null;
}

/**
 * GitHub Copilot CLI `--prompt --output-format json`: one event per line,
 * `{type, data}`. Text streams as `assistant.message_delta`; tools run as
 * `tool.execution_start` / `tool.execution_complete`; `session.error` and a
 * non-zero `result.exitCode` end a failed turn. Reasoning arrives encrypted
 * and is not shown.
 */
export function createCopilotParser(emitter: ChunkEmitter): CliParser {
  const started = new Set<string>();
  const finished = new Set<string>();
  let textSeen = false;
  let failed = false;
  const fail = (message: string) => {
    if (failed) return;
    failed = true;
    emitter.error(message);
  };

  const onLine = (line: string) => {
    const obj = parseJsonLine(line);
    if (!obj) return;
    const data = (obj.data ?? {}) as Data;
    switch (obj.type) {
      case "session.start": {
        if (typeof data.sessionId === "string") {
          emitter.metadata({ copilot: { sessionId: data.sessionId } });
        }
        return;
      }
      case "assistant.message_delta": {
        const delta = data.deltaContent;
        if (typeof delta === "string" && delta) {
          textSeen = true;
          emitter.textDelta(delta);
        }
        return;
      }
      case "assistant.message": {
        // Final text also arrives whole; use it only if nothing streamed.
        const content = data.content;
        if (!textSeen && typeof content === "string" && content.trim()) {
          textSeen = true;
          emitter.textDelta(content);
        }
        return;
      }
      case "assistant.turn_end":
        emitter.endText();
        return;
      case "tool.execution_start": {
        const id = String(data.toolCallId ?? `tool-${started.size}`);
        if (started.has(id)) return;
        started.add(id);
        emitter.tool(id, String(data.toolName ?? "tool"), data.arguments ?? {});
        return;
      }
      case "tool.execution_complete": {
        const id = String(data.toolCallId ?? "");
        if (!started.has(id) || finished.has(id)) return;
        finished.add(id);
        emitter.toolResult(
          id,
          data.success === false ? { error: resultText(data.error ?? data.result) } : resultText(data.result),
        );
        return;
      }
      case "session.error": {
        const message = data.message;
        fail(typeof message === "string" && message ? message : "Copilot run failed");
        return;
      }
      case "result": {
        if (typeof obj.exitCode === "number" && obj.exitCode !== 0 && !textSeen) {
          fail(`Copilot exited with code ${obj.exitCode}`);
        }
        return;
      }
    }
  };

  const errors: string[] = [];
  const onStderr = (line: string) => {
    const text = line.trim();
    if (text && errors.length < 3) errors.push(text);
  };
  // A null code is a run the user stopped: nothing to report.
  const onExit = (code: number | null) => {
    if (textSeen || code === null || code === 0) return;
    fail(errors.join("\n") || `copilot exited with code ${code}`);
  };

  return { onLine, onStderr, onExit };
}
