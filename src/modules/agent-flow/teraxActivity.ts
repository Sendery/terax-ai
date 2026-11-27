import type { UIMessageChunk } from "ai";
import type { FlowActivity } from "@/modules/agent-flow/model";

export function observeTeraxStream(
  stream: ReadableStream<UIMessageChunk>,
  record: (activity: FlowActivity) => void,
  taskKey: (toolCallId: string) => string,
  signal?: AbortSignal,
) {
  const delegates = new Set<string>();
  let finished = false;
  const finish = (kind: "error" | "turn-ended") => {
    if (finished) return;
    finished = true;
    signal?.removeEventListener("abort", onAbort);
    record({ kind });
  };
  const onAbort = () => finish("turn-ended");
  if (signal?.aborted) onAbort();
  else signal?.addEventListener("abort", onAbort, { once: true });
  return stream.pipeThrough(new TransformStream<UIMessageChunk, UIMessageChunk>({
    transform(chunk, controller) {
      if (chunk.type === "tool-input-available") {
        const name = chunk.toolName;
        const input = chunk.input as { type?: unknown; subagent_type?: unknown } | undefined;
        const openCodeTask = name === "task" && typeof input?.subagent_type === "string";
        if (name === "run_subagent" || name === "spawn_agent" || openCodeTask) {
          delegates.add(chunk.toolCallId);
          const role = openCodeTask ? input?.subagent_type : input?.type;
          const label = typeof role === "string" && /^[a-z_]{1,40}$/.test(role) ? role : "Subagent";
          record({ kind: "delegated", text: label, taskId: taskKey(chunk.toolCallId) });
        } else {
          record({ kind: "tool", text: name.slice(0, 120) });
        }
      } else if ((chunk.type === "tool-output-available" || chunk.type === "tool-output-error" || chunk.type === "tool-output-denied")
        && delegates.delete(chunk.toolCallId)) {
        const output = chunk.type === "tool-output-available" ? chunk.output : undefined;
        const failedTool = chunk.type !== "tool-output-available" || (output && typeof output === "object" && "error" in output);
        record({ kind: failedTool ? "error" : "returned", taskId: taskKey(chunk.toolCallId) });
      } else if (chunk.type === "error") {
        finish("error");
      }
      controller.enqueue(chunk);
    },
    flush() {
      finish("turn-ended");
    },
  }));
}
