import type { UIMessage } from "ai";
import { describe, expect, it, vi } from "vitest";
import { compactConversation, compactPrompt, runUserShell } from "./conversation";
import { TERAX_CMD_RE } from "./slashCommands";
import { userShellBlockOf, userShellMessage } from "./userShell";

const text = (id: string, role: "user" | "assistant", value: string): UIMessage => ({
  id,
  role,
  parts: [{ type: "text", text: value }],
});

function chat(messages: UIMessage[], reply: string | null, status = "ready") {
  const c = {
    messages,
    status,
    sendMessage: vi.fn(async ({ text: prompt }: { text: string }) => {
      c.messages = [...c.messages, text("u-compact", "user", prompt)];
      if (reply !== null) c.messages = [...c.messages, text("a-summary", "assistant", reply)];
    }),
  };
  return c;
}

const result = (stdout: string, extra = {}) => ({
  stdout,
  stderr: "",
  exit_code: 0,
  timed_out: false,
  truncated: false,
  ...extra,
});

describe("runUserShell", () => {
  it("shows the command as running, then replaces it with the result", async () => {
    const c = chat([text("1", "user", "hi")], null);
    let seenWhileRunning: string | undefined;
    const run = vi.fn(async () => {
      seenWhileRunning = userShellBlockOf(c.messages[1])?.state;
      return result("M src/a.ts\n", { stderr: "warning\n" });
    });
    const block = await runUserShell(c, { visibility: "agent", command: "git status" }, "/repo", run);
    expect(run).toHaveBeenCalledWith("git status", "/repo", 120);
    expect(seenWhileRunning).toBe("running");
    expect(c.messages).toHaveLength(2);
    expect(userShellBlockOf(c.messages[1])).toEqual(block);
    expect(block).toMatchObject({ state: "done", exitCode: 0, output: "M src/a.ts\nwarning" });
  });

  it("records a timeout and a spawn failure instead of losing them", async () => {
    const c = chat([], null);
    const slow = await runUserShell(
      c,
      { visibility: "private", command: "sleep 999" },
      null,
      async () => result("", { timed_out: true, exit_code: null }),
    );
    expect(slow).toMatchObject({ state: "timeout", visibility: "private" });
    const broken = await runUserShell(c, { visibility: "agent", command: "x" }, null, async () => {
      throw new Error("no shell");
    });
    expect(broken).toMatchObject({ state: "failed", output: "no shell" });
    expect(c.messages).toHaveLength(2);
  });
});

describe("compactConversation", () => {
  const history = [
    text("1", "user", "build the thing"),
    text("2", "assistant", "done, see src/a.ts"),
    userShellMessage("3", {
      visibility: "private",
      command: "cat .env",
      output: "TOP SECRET",
      exitCode: 0,
      state: "done",
    }),
  ];

  it("replaces the history with the summary the model wrote", async () => {
    const c = chat(history, "Goal: build the thing. State: src/a.ts written.");
    const out = await compactConversation(c, "the file paths");
    expect(out).toEqual({ ok: true, replaced: 3 });
    expect(c.sendMessage.mock.calls[0][0].text).toContain("the file paths");
    expect(c.messages).toHaveLength(2);
    expect(c.messages[0].role).toBe("user");
    expect((c.messages[0].parts[0] as { text: string }).text.match(TERAX_CMD_RE)?.[1]).toBe("compact");
    expect(c.messages[1]).toEqual(
      text("a-summary", "assistant", "Goal: build the thing. State: src/a.ts written."),
    );
    expect(JSON.stringify(c.messages)).not.toContain("TOP SECRET");
  });

  // Compaction is destructive: without a summary in hand, nothing is touched.
  it("leaves the conversation untouched when no summary comes back", async () => {
    for (const c of [chat(history, null), chat(history, "   "), chat(history, "partial", "error")]) {
      const out = await compactConversation(c, "");
      expect(out.ok).toBe(false);
      expect(c.messages).toBe(history);
    }
  });

  it("does not spend a turn on a conversation with nothing to compact", async () => {
    const c = chat([history[0], history[2]], "summary");
    expect(await compactConversation(c, "")).toEqual({ ok: false, reason: "Nothing to compact yet" });
    expect(c.sendMessage).not.toHaveBeenCalled();
  });

  it("asks for a summary without tool use", () => {
    expect(compactPrompt("")).toContain("Do not call tools");
    expect(compactPrompt("")).not.toContain("particular attention");
  });
});
