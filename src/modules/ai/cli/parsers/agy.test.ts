import type { UIMessageStreamWriter } from "ai";
import { describe, expect, it, vi } from "vitest";
import { createAgyParser } from "./agy";
import { ChunkEmitter } from "./emitter";

type Chunk = Record<string, unknown>;

function harness() {
  const chunks: Chunk[] = [];
  const writer = {
    write: (chunk: Chunk) => chunks.push(chunk),
  } as unknown as UIMessageStreamWriter;
  const onUsage = vi.fn();
  const emitter = new ChunkEmitter(writer, onUsage);
  const parser = createAgyParser(emitter);
  const feed = (...events: unknown[]) => {
    for (const e of events) parser.onLine(typeof e === "string" ? e : JSON.stringify(e));
  };
  const text = () =>
    chunks
      .filter((c) => c.type === "text-delta")
      .map((c) => c.delta)
      .join("");
  const errors = () => chunks.filter((c) => c.type === "error").map((c) => c.errorText);
  return { chunks, parser, emitter, feed, text, errors, onUsage };
}

const CONV = "cb744511-269f-4700-81a0-ddc9c1da539d";
const init = { event: "init", conversation_id: CONV, init: { cwd: "/repo", tools: [] } };
const step = (s: Record<string, unknown>) => ({
  event: "step_update",
  step_update: { conversation_id: CONV, ...s },
});

// Lines below are trimmed copies of what agy 1.5.12 printed for real turns.
describe("agy stream-json parser", () => {
  it("streams agent text and records the conversation", () => {
    const h = harness();
    h.feed(
      init,
      step({ step_index: 0, state: "DONE", step_type: "user_input" }),
      step({ step_index: 2, state: "ACTIVE", step_type: "agent_response", text_delta: "Blue is the color of the clear sky a" }),
      step({ step_index: 2, state: "ACTIVE", step_type: "agent_response", text_delta: "nd deep ocean." }),
      step({ step_index: 2, state: "DONE", step_type: "agent_response", text_delta: "\n", usage: { total_tokens: 19016 } }),
      { event: "result", result: { conversation_id: CONV, status: "SUCCESS", response: "Blue is the color of the clear sky and deep ocean.\n" } },
    );
    h.parser.onExit?.(0);
    h.emitter.finish();
    expect(h.text()).toBe("Blue is the color of the clear sky and deep ocean.\n");
    expect(h.chunks).toContainEqual({
      type: "message-metadata",
      messageMetadata: { agy: { conversationId: CONV } },
    });
    expect(h.errors()).toEqual([]);
    expect(h.onUsage).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ reportedTotalTokens: 19016 }));
  });

  it("renders a tool call once and closes it with its output or error", () => {
    const h = harness();
    const params = { Path: "/repo/note.txt" };
    h.feed(
      init,
      step({ step_index: 2, state: "ACTIVE", step_type: "tool", tool_name: "read_file", tool_info: { name: "read_file", parameters: params } }),
      step({ step_index: 2, state: "DONE", step_type: "tool", tool_name: "read_file", tool_info: { name: "read_file", parameters: params, output: "1 lines, 6 bytes" } }),
      step({ step_index: 4, state: "ACTIVE", step_type: "tool", tool_name: "run_command", tool_info: { name: "run_command", parameters: { CommandLine: "ls" } } }),
      step({ step_index: 4, state: "ERROR", step_type: "tool", tool_name: "run_command", tool_info: { name: "run_command", error: { type: "TOOL_ERROR", message: "permission check failed" } } }),
      step({ step_index: 4, state: "ERROR", step_type: "tool", tool_name: "run_command", tool_info: { name: "run_command", error: { message: "again" } } }),
    );
    const calls = h.chunks.filter((c) => c.type === "tool-input-available");
    const results = h.chunks.filter((c) => c.type === "tool-output-available");
    expect(calls.map((c) => [c.toolCallId, c.toolName, c.input])).toEqual([
      [`${CONV}:2`, "read_file", params],
      [`${CONV}:4`, "run_command", { CommandLine: "ls" }],
    ]);
    expect(results.map((c) => c.output)).toEqual([
      "1 lines, 6 bytes",
      { error: "permission check failed" },
    ]);
  });

  // agy reports ERROR when an earlier attempt failed even if a retry answered.
  it("does not turn a retried request into an error once text arrived", () => {
    const h = harness();
    h.feed(
      init,
      step({ step_index: 2, state: "DONE", step_type: "agent_response", text_delta: "OK" }),
      { event: "result", result: { status: "ERROR", response: "OK", error: "API error (attempt 1): UNAVAILABLE" } },
    );
    h.parser.onExit?.(0);
    expect(h.text()).toBe("OK");
    expect(h.errors()).toEqual([]);
  });

  it("falls back to the final response when no delta streamed", () => {
    const h = harness();
    h.feed(init, { event: "result", result: { status: "SUCCESS", response: "Done." } });
    expect(h.text()).toBe("Done.");
  });

  it("explains an empty turn with the denial agy wrote on stderr, once", () => {
    const h = harness();
    h.feed(init, { event: "result", result: { status: "SUCCESS", response: "" } });
    h.parser.onStderr?.("jetski: no output produced — a tool required the \"command\" permission that headless mode cannot prompt for");
    h.parser.onExit?.(0);
    expect(h.errors()).toHaveLength(1);
    expect(h.errors()[0]).toContain("headless mode cannot prompt");
  });

  it("reports a failed turn once and stays quiet when the user stopped it", () => {
    const failed = harness();
    failed.feed(init, { event: "result", result: { status: "ERROR", response: "", error: "quota exhausted" } });
    failed.parser.onExit?.(1);
    expect(failed.errors()).toEqual(["quota exhausted"]);

    const stopped = harness();
    stopped.feed(init);
    stopped.parser.onExit?.(null);
    expect(stopped.errors()).toEqual([]);
  });

  it("ignores noise that is not JSON", () => {
    const h = harness();
    h.feed("Fetching available models...", "", "{not json");
    expect(h.chunks).toEqual([]);
  });
});
