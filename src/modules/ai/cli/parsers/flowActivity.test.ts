import type { UIMessageStreamWriter } from "ai";
import { describe, expect, it, vi } from "vitest";
import { createCursorParser } from "./cursor";
import { ChunkEmitter } from "./emitter";
import { createOpenCodeParser } from "./opencode";

describe("CLI activity in Terax AI", () => {
  it("emits a single Cursor tool call and result from top-level events", () => {
    const write = vi.fn();
    const parser = createCursorParser(new ChunkEmitter({ write } as unknown as UIMessageStreamWriter));
    const started = { type: "tool_call", subtype: "started", call_id: "read", tool_call: { readToolCall: { args: { path: "notes.md" } } } };
    const completed = { ...started, subtype: "completed", tool_call: { readToolCall: { result: { success: {} } } } };
    for (const event of [started, completed, completed]) parser.onLine(JSON.stringify(event));
    expect(write.mock.calls.map(([chunk]) => chunk.type)).toEqual(["tool-input-available", "tool-output-available"]);
    expect(write.mock.calls[0][0]).toMatchObject({ toolCallId: "read", toolName: "read" });
  });

  it("emits OpenCode tool_use parts and counts each step once", () => {
    const write = vi.fn();
    const onUsage = vi.fn();
    const parser = createOpenCodeParser(new ChunkEmitter({ write } as unknown as UIMessageStreamWriter, onUsage));
    const tool = { type: "tool_use", part: { id: "tool", tool: "task", state: { status: "completed", input: { subagent_type: "explore" } } } };
    const step = { type: "step_finish", part: { id: "step", tokens: { input: 32, output: 20, cache: { read: 8 } } } };
    for (const event of [tool, step, step]) parser.onLine(JSON.stringify(event));
    expect(write.mock.calls[0][0]).toMatchObject({ type: "tool-input-available", toolName: "task" });
    expect(onUsage).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ inputTokens: 32, outputTokens: 20, cachedInputTokens: 8 }));
  });
});
