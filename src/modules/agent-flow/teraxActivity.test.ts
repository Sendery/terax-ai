import type { UIMessageChunk } from "ai";
import { describe, expect, it } from "vitest";
import type { FlowActivity } from "@/modules/agent-flow/model";
import { observeTeraxStream } from "@/modules/agent-flow/teraxActivity";

describe("Terax AI activity", () => {
  it("records tools and delegated work without storing inputs, replies or outputs", async () => {
    const chunks: UIMessageChunk[] = [
      { type: "tool-input-available", toolCallId: "read", toolName: "read_file", input: { path: "/private-content" } },
      { type: "tool-input-available", toolCallId: "agent", toolName: "run_subagent", input: { type: "reviewer", prompt: "Private request" } },
      { type: "text-delta", id: "reply", delta: "Private response" },
      { type: "tool-output-available", toolCallId: "agent", output: { summary: "Private result" } },
    ];
    const events: FlowActivity[] = [];
    const output = observeTeraxStream(new ReadableStream<UIMessageChunk>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    }), (event) => events.push(event), (id) => `turn:${id}`);
    const reader = output.getReader();
    for (const chunk of chunks) expect((await reader.read()).value).toBe(chunk);
    expect((await reader.read()).done).toBe(true);
    expect(events).toEqual([
      { kind: "tool", text: "read_file" },
      { kind: "delegated", text: "reviewer", taskId: "turn:agent" },
      { kind: "returned", taskId: "turn:agent" },
      { kind: "turn-ended" },
    ]);
  });
});
