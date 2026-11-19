import type { UIMessageStreamWriter } from "ai";
import { describe, expect, it } from "vitest";
import { createCopilotParser } from "./copilot";
import { ChunkEmitter } from "./emitter";

type Chunk = Record<string, unknown>;

function harness() {
  const chunks: Chunk[] = [];
  const emitter = new ChunkEmitter({
    write: (c: Chunk) => chunks.push(c),
  } as unknown as UIMessageStreamWriter);
  const parser = createCopilotParser(emitter);
  const feed = (...events: unknown[]) => {
    for (const e of events) parser.onLine(JSON.stringify(e));
  };
  const text = () =>
    chunks.filter((c) => c.type === "text-delta").map((c) => c.delta).join("");
  const errors = () => chunks.filter((c) => c.type === "error").map((c) => c.errorText);
  return { chunks, parser, emitter, feed, text, errors };
}

const ev = (type: string, data: Record<string, unknown> = {}) => ({ type, data });

// Trimmed from a real Copilot CLI 1.0.112 run with the Terax MCP attached.
describe("copilot json parser", () => {
  it("streams text, renders tools with results and records the session", () => {
    const h = harness();
    h.feed(
      ev("session.start", { sessionId: "s-1", copilotVersion: "1.0.112" }),
      ev("session.mcp_server_tools_loaded", { serverName: "terax", toolCount: 9 }),
      ev("tool.execution_start", { toolCallId: "c1", toolName: "bash", arguments: { command: "ls" } }),
      ev("tool.execution_complete", { toolCallId: "c1", success: true, result: { content: "note.txt\n", detailedContent: "x" } }),
      ev("tool.execution_start", { toolCallId: "c2", toolName: "terax-terax_inspect", arguments: { action: "list_spaces" } }),
      ev("tool.execution_complete", { toolCallId: "c2", success: true, result: { content: '{"spaces":[]}' } }),
      ev("assistant.message_start", { messageId: "m", phase: "final_answer" }),
      ev("assistant.message_delta", { messageId: "m", deltaContent: "hello" }),
      ev("assistant.message_delta", { messageId: "m", deltaContent: " | Terax spaces: 1" }),
      ev("assistant.message", { messageId: "m", content: "hello | Terax spaces: 1" }),
      ev("assistant.turn_end", { turnId: "3" }),
      { type: "result", sessionId: "s-1", exitCode: 0 },
    );
    h.parser.onExit?.(0);
    expect(h.text()).toBe("hello | Terax spaces: 1");
    expect(
      h.chunks.filter((c) => c.type === "tool-input-available").map((c) => [c.toolName, c.input]),
    ).toEqual([
      ["bash", { command: "ls" }],
      ["terax-terax_inspect", { action: "list_spaces" }],
    ]);
    expect(h.chunks.filter((c) => c.type === "tool-output-available").map((c) => c.output)).toEqual([
      "note.txt\n",
      '{"spaces":[]}',
    ]);
    expect(h.chunks).toContainEqual({
      type: "message-metadata",
      messageMetadata: { copilot: { sessionId: "s-1" } },
    });
    expect(h.errors()).toEqual([]);
  });

  it("uses the whole message when nothing streamed", () => {
    const h = harness();
    h.feed(ev("assistant.message", { content: "Done." }));
    expect(h.text()).toBe("Done.");
  });

  it("reports a failed tool as an error result", () => {
    const h = harness();
    h.feed(
      ev("tool.execution_start", { toolCallId: "c", toolName: "bash", arguments: {} }),
      ev("tool.execution_complete", { toolCallId: "c", success: false, error: { content: "denied" } }),
    );
    expect(h.chunks.find((c) => c.type === "tool-output-available")?.output).toEqual({
      error: "denied",
    });
  });

  // The account's default model was unavailable in the real run: the user
  // must see why, once, not a generic exit code.
  it("surfaces a session error once", () => {
    const h = harness();
    h.feed(
      ev("session.error", { errorType: "query", message: 'Execution failed: Model "gpt-5.5" is not available.' }),
      { type: "result", exitCode: 1 },
    );
    h.parser.onExit?.(1);
    expect(h.errors()).toEqual(['Execution failed: Model "gpt-5.5" is not available.']);
  });

  it("stays quiet when the user stopped the run", () => {
    const h = harness();
    h.parser.onExit?.(null);
    expect(h.errors()).toEqual([]);
  });
});
