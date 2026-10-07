import type { UIMessageStreamWriter } from "ai";
import { describe, expect, it } from "vitest";
import { ChunkEmitter } from "./emitter";
import { createPiParser, PI_TOOL_OUTPUT_LIMIT, piToolOutput } from "./pi";

type Chunk = Record<string, unknown>;

function harness(metadata?: Record<string, unknown>) {
  const chunks: Chunk[] = [];
  const writer = {
    write: (chunk: Chunk) => chunks.push(chunk),
  } as unknown as UIMessageStreamWriter;
  const emitter = new ChunkEmitter(writer);
  const parser = createPiParser(emitter, { metadata });
  const feed = (...events: unknown[]) => {
    for (const e of events) parser.onLine(typeof e === "string" ? e : JSON.stringify(e));
  };
  return { chunks, parser, emitter, feed };
}

const update = (assistantMessageEvent: Chunk) => ({
  type: "message_update",
  usage: {},
  assistantMessageEvent,
});

describe("createPiParser", () => {
  it("streams text and thinking and records the session once it opens", () => {
    const meta = { pi: { sessionId: "terax-s-1-n", cwd: "/repo", userTurns: 1 } };
    const { chunks, parser, feed } = harness(meta);
    feed(
      { type: "session", version: 3, id: "terax-s-1-n", cwd: "/repo" },
      { type: "agent_start" },
      update({ type: "thinking_start", contentIndex: 0 }),
      update({ type: "thinking_delta", contentIndex: 0, delta: "pienso" }),
      update({ type: "thinking_end", contentIndex: 0, content: "pienso" }),
      update({ type: "text_start", contentIndex: 1 }),
      update({ type: "text_delta", contentIndex: 1, delta: "Ho" }),
      update({ type: "text_delta", contentIndex: 1, delta: "la" }),
      update({ type: "text_end", contentIndex: 1, content: "Hola" }),
      { type: "message_end", message: { role: "assistant", stopReason: "stop" } },
      { type: "agent_settled" },
    );
    parser.onExit?.(0);

    expect(chunks[0]).toEqual({ type: "message-metadata", messageMetadata: meta });
    expect(chunks.filter((c) => c.type === "message-metadata")).toHaveLength(1);
    expect(chunks.filter((c) => c.type === "reasoning-delta").map((c) => c.delta)).toEqual(["pienso"]);
    expect(chunks.filter((c) => c.type === "text-delta").map((c) => c.delta)).toEqual(["Ho", "la"]);
    expect(chunks.some((c) => c.type === "error")).toBe(false);
  });

  it("renders tool executions as provider-executed tool parts", () => {
    const { chunks, feed } = harness();
    feed(
      { type: "tool_execution_start", toolCallId: "t1", toolName: "terax_call", args: { command: "tab.focus" } },
      {
        type: "tool_execution_end",
        toolCallId: "t1",
        toolName: "terax_call",
        result: { content: [{ type: "text", text: "{\"ok\":true}" }], details: {} },
        isError: false,
      },
    );
    expect(chunks).toEqual([
      expect.objectContaining({
        type: "tool-input-available",
        toolCallId: "t1",
        toolName: "terax_call",
        input: { command: "tab.focus" },
        providerExecuted: true,
      }),
      expect.objectContaining({
        type: "tool-output-available",
        toolCallId: "t1",
        output: "{\"ok\":true}",
      }),
    ]);
  });

  it("does not report a provider error that a retry recovered from", () => {
    const { chunks, parser, feed } = harness();
    feed(
      { type: "message_end", message: { role: "assistant", stopReason: "error", errorMessage: "529 overloaded" } },
      { type: "auto_retry_start", attempt: 1 },
      update({ type: "text_delta", contentIndex: 0, delta: "ok" }),
      { type: "message_end", message: { role: "assistant", stopReason: "stop" } },
    );
    parser.onExit?.(0);
    expect(chunks.some((c) => c.type === "error")).toBe(false);
  });

  it("reports the final provider error once, first line only", () => {
    const { chunks, parser, feed } = harness();
    feed({
      type: "message_end",
      message: {
        role: "assistant",
        stopReason: "error",
        errorMessage: "OAuth refresh failed for anthropic\n    at postJson (x.js:1)",
      },
    });
    parser.onExit?.(0);
    expect(chunks.filter((c) => c.type === "error")).toEqual([
      { type: "error", errorText: "OAuth refresh failed for anthropic" },
    ]);
  });

  it("surfaces startup failures from stderr when Pi exits non-zero", () => {
    const { chunks, parser } = harness({ pi: {} });
    parser.onStderr?.("");
    parser.onStderr?.('Error: Model "nope" not found. Use --list-models to see available models.');
    parser.onExit?.(1);
    expect(chunks.some((c) => c.type === "message-metadata")).toBe(false);
    expect(chunks).toEqual([
      {
        type: "error",
        errorText:
          'Pi exited with code 1: Error: Model "nope" not found. Use --list-models to see available models.',
      },
    ]);
  });

  it("closes tools still open when the run is cut short", () => {
    const { chunks, parser, feed } = harness();
    feed({ type: "tool_execution_start", toolCallId: "t9", toolName: "bash", args: {} });
    parser.onExit?.(null);
    expect(chunks[chunks.length - 1]).toEqual(
      expect.objectContaining({ type: "tool-output-available", toolCallId: "t9", output: { error: "Interrupted" } }),
    );
    expect(chunks.some((c) => c.type === "error")).toBe(false);
  });
});

describe("piToolOutput", () => {
  it("joins text blocks, names images and caps the size", () => {
    expect(
      piToolOutput({ content: [{ type: "text", text: "a" }, { type: "image", data: "x" }] }, false),
    ).toBe("a\n[image]");
    expect(piToolOutput({ content: [{ type: "text", text: "boom" }] }, true)).toEqual({ error: "boom" });
    const big = piToolOutput({ content: [{ type: "text", text: "x".repeat(PI_TOOL_OUTPUT_LIMIT + 10) }] }, false);
    expect(String(big)).toMatch(/\[truncated\]$/);
  });
});
