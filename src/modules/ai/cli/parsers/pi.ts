import {
  type ChunkEmitter,
  type CliParser,
  parseJsonLine,
  type ParserRun,
} from "./emitter";

/** Tool output kept in the chat history. Pi keeps the full result itself. */
export const PI_TOOL_OUTPUT_LIMIT = 32 * 1024;
const DIAGNOSTIC_LINES = 6;

type Json = Record<string, unknown>;

function asRecord(value: unknown): Json | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : null;
}

function clip(text: string): string {
  return text.length > PI_TOOL_OUTPUT_LIMIT
    ? `${text.slice(0, PI_TOOL_OUTPUT_LIMIT)}\n[truncated]`
    : text;
}

/** Pi tool results are `{ content: [{type:"text"|"image"}], details }`. The
 *  chat only needs the readable part; images are named, not inlined. */
export function piToolOutput(result: unknown, isError: boolean): unknown {
  const content = asRecord(result)?.content;
  const text = Array.isArray(content)
    ? content
        .map((block) => {
          const b = asRecord(block);
          if (b?.type === "text") return String(b.text ?? "");
          if (b?.type === "image") return "[image]";
          return "";
        })
        .filter(Boolean)
        .join("\n")
    : typeof result === "string"
      ? result
      : "";
  const output = clip(text);
  return isError ? { error: output || "Tool failed" } : output;
}

/**
 * Pi `--mode json`: a session header, then agent/turn/message/tool events.
 * Text and thinking stream as `message_update` deltas; tool calls are taken
 * from `tool_execution_*`, which carry the final arguments and the result.
 *
 * A failed provider call ends the assistant message with `stopReason:
 * "error"`, but Pi may retry and succeed, so the error is held until the run
 * ends and only reported if nothing replaced it. Startup failures (unknown
 * model, missing auth) never reach JSON; they surface from stderr on exit.
 */
export function createPiParser(emitter: ChunkEmitter, run?: ParserRun): CliParser {
  const openTools = new Set<string>();
  const diagnostics: string[] = [];
  let sawSession = false;
  let pendingError: string | null = null;
  let reportedError = false;

  const note = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    diagnostics.push(trimmed);
    if (diagnostics.length > DIAGNOSTIC_LINES) diagnostics.shift();
  };

  const onLine = (line: string) => {
    const obj = parseJsonLine(line);
    if (!obj) {
      note(line);
      return;
    }
    switch (obj.type) {
      case "session":
        if (!sawSession && run?.metadata) emitter.metadata(run.metadata);
        sawSession = true;
        return;
      case "message_update":
        handleUpdate(asRecord(obj.assistantMessageEvent));
        return;
      case "tool_execution_start": {
        const id = String(obj.toolCallId ?? "");
        if (!id || openTools.has(id)) return;
        emitter.tool(id, String(obj.toolName ?? "tool"), obj.args ?? {});
        openTools.add(id);
        return;
      }
      case "tool_execution_end": {
        const id = String(obj.toolCallId ?? "");
        if (!id) return;
        if (!openTools.has(id)) {
          emitter.tool(id, String(obj.toolName ?? "tool"), obj.args ?? {});
        }
        emitter.toolResult(id, piToolOutput(obj.result, obj.isError === true));
        openTools.delete(id);
        return;
      }
      case "message_end":
        handleMessageEnd(asRecord(obj.message));
        return;
      case "auto_retry_end":
        if (obj.success === false && typeof obj.finalError === "string") {
          pendingError = obj.finalError;
        }
        return;
    }
  };

  function handleUpdate(event: Json | null): void {
    if (!event) return;
    switch (event.type) {
      case "text_delta":
        emitter.textDelta(String(event.delta ?? ""));
        return;
      case "text_end":
        emitter.endText();
        return;
      case "thinking_delta":
        emitter.reasoningDelta(String(event.delta ?? ""));
        return;
      case "thinking_end":
        emitter.endReasoning();
        return;
    }
  }

  function handleMessageEnd(message: Json | null): void {
    if (message?.role !== "assistant") return;
    if (message.stopReason === "error") {
      pendingError =
        typeof message.errorMessage === "string" && message.errorMessage
          ? firstLine(message.errorMessage)
          : "Pi run failed";
    } else if (message.stopReason !== "aborted") {
      pendingError = null;
    }
  }

  function report(text: string): void {
    if (reportedError) return;
    reportedError = true;
    emitter.error(text);
  }

  return {
    onLine,
    onStderr: note,
    onExit(code) {
      for (const id of openTools) emitter.toolResult(id, { error: "Interrupted" });
      openTools.clear();
      if (pendingError) {
        report(pendingError);
      } else if (code !== null && code !== 0) {
        const detail = diagnostics.join("\n");
        report(detail ? `Pi exited with code ${code}: ${detail}` : `Pi exited with code ${code}`);
      }
    },
  };
}

function firstLine(text: string): string {
  const line = text.split("\n", 1)[0].trim();
  return line.length > 500 ? `${line.slice(0, 500)}...` : line;
}
