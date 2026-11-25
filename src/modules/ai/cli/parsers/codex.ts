import { type ChunkEmitter, parseJsonLine, type CliParser } from "./emitter";

/**
 * Codex `exec --json`. Emits a thread/turn/item event model. Items arrive as
 * started/updated/completed; agent_message and reasoning carry cumulative
 * text (we emit the growing suffix), command/file/mcp items render as tool
 * cards. No token-level streaming, so text appears per item update.
 */
export function createCodexParser(emitter: ChunkEmitter): CliParser {
  const textSeen = new Map<string, number>();
  const reasoningSeen = new Map<string, number>();
  const toolStarted = new Set<string>();
  const children = new Map<string, string>();

  const onLine = (line: string) => {
    const obj = parseJsonLine(line);
    if (!obj) return;
    const type = obj.type as string | undefined;

    if (type === "item.started" || type === "item.updated" || type === "item.completed") {
      handleItem(obj.item as Record<string, unknown> | undefined, type);
      return;
    }
    if (type === "turn.completed") {
      const usage = obj.usage as Record<string, unknown> | undefined;
      if (usage) emitter.usage(usage.input_tokens, usage.output_tokens, usage.cached_input_tokens);
      return;
    }
    if (type === "turn.failed" || type === "error") {
      const err = obj.error as Record<string, unknown> | undefined;
      emitter.error(
        (err?.message as string) ?? (obj.message as string) ?? "Codex run failed",
      );
    }
  };

  function handleItem(item: Record<string, unknown> | undefined, phase: string): void {
    if (!item) return;
    const id = String(item.id ?? "item");
    const itype = item.item_type ?? item.type;

    if (itype === "agent_message") {
      const full = String(item.text ?? "");
      emitter.textDelta(full.slice(textSeen.get(id) ?? 0));
      textSeen.set(id, full.length);
      return;
    }
    if (itype === "reasoning") {
      const full = String(item.text ?? "");
      emitter.reasoningDelta(full.slice(reasoningSeen.get(id) ?? 0));
      reasoningSeen.set(id, full.length);
      return;
    }
    if (itype === "collab_tool_call") {
      const spawn = item.tool === "spawn_agent";
      if (!toolStarted.has(id) && typeof item.tool === "string") {
        emitter.tool(id, item.tool, {});
        toolStarted.add(id);
      }
      if (spawn && Array.isArray(item.receiver_thread_ids)) {
        for (const thread of item.receiver_thread_ids) {
          if (typeof thread === "string") children.set(thread, id);
        }
      }
      if (phase === "item.completed" && (!spawn || item.status === "failed")) {
        emitter.toolResult(id, item.status === "failed" ? { error: "Tool failed" } : {});
      }
      const states = item.agents_states as Record<string, { status?: string }> | undefined;
      for (const [thread, state] of Object.entries(states ?? {})) {
        const call = children.get(thread);
        if (call && (state?.status === "completed" || state?.status === "shutdown" || state?.status === "errored")) {
          emitter.toolResult(call, state.status === "errored" ? { error: "Subagent failed" } : {});
          children.delete(thread);
        }
      }
      return;
    }
    if (itype === "web_search") {
      if (!toolStarted.has(id)) {
        emitter.tool(id, "Web search", {});
        toolStarted.add(id);
      }
      if (phase === "item.completed") emitter.toolResult(id, {});
      return;
    }
    if (itype === "command_execution") {
      if (!toolStarted.has(id)) {
        emitter.tool(id, "shell", { command: item.command ?? "" });
        toolStarted.add(id);
      }
      if (phase === "item.completed") {
        emitter.toolResult(id, {
          output: item.aggregated_output ?? item.output ?? "",
          exit_code: item.exit_code ?? null,
        });
      }
      return;
    }
    if (itype === "file_change" || itype === "patch") {
      if (!toolStarted.has(id)) {
        emitter.tool(id, "edit", item.changes ?? item);
        toolStarted.add(id);
      }
      if (phase === "item.completed") emitter.toolResult(id, { status: item.status ?? "done" });
      return;
    }
    if (itype === "mcp_tool_call") {
      if (!toolStarted.has(id)) {
        emitter.tool(id, String(item.tool ?? item.server ?? "mcp"), item.arguments ?? {});
        toolStarted.add(id);
      }
      if (phase === "item.completed") emitter.toolResult(id, item.result ?? null);
    }
  }

  return { onLine };
}
