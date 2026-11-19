import { describe, expect, it } from "vitest";

import { SUMMARY_MAX, summarizeToolInput } from "./toolSummary";

const text = (name: string, input: unknown) =>
  summarizeToolInput(name, input)?.text ?? null;

describe("summarizeToolInput: commands", () => {
  it("shows the command of shell-like tools", () => {
    expect(text("shell", { command: "pnpm test" })).toBe("pnpm test");
    expect(text("Bash", { command: "ls -la", description: "List" })).toBe(
      "ls -la",
    );
    expect(text("exec", { cmd: "make" })).toBe("make");
  });

  it("matches field names regardless of case", () => {
    expect(
      text("run_command", { CommandLine: "git status", Cwd: "/repo" }),
    ).toBe("git status");
  });

  it("joins argv arrays and quotes arguments that need it", () => {
    expect(text("shell", { command: ["bash", "-lc", "echo hi"] })).toBe(
      "bash -lc 'echo hi'",
    );
    expect(text("exec", { argv: ["rm", "it's"] })).toBe(`rm 'it'\\''s'`);
  });

  it("collapses a multi-line command into one line but keeps it whole for the tooltip", () => {
    const s = summarizeToolInput("bash", { command: "cat <<EOF\na\nb\nEOF" });
    expect(s?.text).toBe("cat <<EOF a b EOF");
    expect(s?.full).toBe("cat <<EOF\na\nb\nEOF");
  });
});

describe("summarizeToolInput: files and searches", () => {
  it("shows the path of file tools", () => {
    expect(text("read", { path: "src/a.ts" })).toBe("src/a.ts");
    expect(text("Edit", { file_path: "/x/b.ts", old_string: "a" })).toBe(
      "/x/b.ts",
    );
    expect(text("view_file", { AbsolutePath: "/x/c.ts" })).toBe("/x/c.ts");
    expect(text("read", { filePath: "/x/d.ts" })).toBe("/x/d.ts");
  });

  it("summarises a list of changed files", () => {
    expect(
      text("edit", [
        { path: "a.ts", kind: "update" },
        { path: "b.ts", kind: "add" },
      ]),
    ).toBe("a.ts +1 more");
    expect(text("edit", { changes: [{ path: "only.ts" }] })).toBe("only.ts");
  });

  it("prefers the pattern for search tools and names where it searched", () => {
    expect(text("Grep", { pattern: "TODO", path: "src" })).toBe("TODO in src");
    expect(text("grep_search", { Query: "useChat", SearchPath: "/r" })).toBe(
      "useChat in /r",
    );
    expect(text("WebSearch", { query: "tauri zoom" })).toBe("tauri zoom");
  });

  it("shows a url", () => {
    expect(text("WebFetch", { url: "https://x.dev", prompt: "read" })).toBe(
      "https://x.dev",
    );
  });
});

describe("summarizeToolInput: MCP calls", () => {
  it("shows server/tool and the action argument", () => {
    expect(
      text("call_mcp_tool", {
        ServerName: "terax",
        ToolName: "terax_inspect",
        Arguments: { action: "snapshot" },
      }),
    ).toBe("terax/terax_inspect snapshot");
  });

  it("reads the action from JSON-encoded arguments", () => {
    expect(
      text("call_mcp_tool", {
        ServerName: "terax",
        ToolName: "terax_tabs",
        Arguments: '{"action":"list"}',
      }),
    ).toBe("terax/terax_tabs list");
  });

  it("omits the action when there is none", () => {
    expect(
      text("call_mcp_tool", { ServerName: "github", ToolName: "get_issue" }),
    ).toBe("github/get_issue");
  });

  it("shows the action of a namespaced MCP tool", () => {
    expect(text("mcp__terax__terax_inspect", { action: "snapshot" })).toBe(
      "snapshot",
    );
  });
});

describe("summarizeToolInput: fallbacks and bounds", () => {
  it("returns null when there is nothing to show", () => {
    expect(summarizeToolInput("noop", {})).toBeNull();
    expect(summarizeToolInput("noop", null)).toBeNull();
    expect(summarizeToolInput("noop", { n: 3, ok: true })).toBeNull();
    expect(
      summarizeToolInput("todo", { todos: [{ content: "x" }] }),
    ).toBeNull();
    expect(summarizeToolInput("shell", { command: "   " })).toBeNull();
  });

  it("falls back to a descriptive field", () => {
    expect(text("Task", { description: "Find usages", prompt: "long" })).toBe(
      "Find usages",
    );
  });

  it("truncates long values with an ellipsis", () => {
    const long = "x".repeat(SUMMARY_MAX * 3);
    const s = summarizeToolInput("shell", { command: long });
    expect(s?.text.length).toBe(SUMMARY_MAX);
    expect(s?.text.endsWith("…")).toBe(true);
    expect(s?.full).toBe(long);
  });

  it("accepts a bare string input", () => {
    expect(text("shell", "echo ok")).toBe("echo ok");
  });
});
