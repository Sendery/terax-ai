export type ToolSummary = {
  /** One line, whitespace collapsed, bounded for the row. */
  text: string;
  /** Untruncated value for the tooltip, bounded only against runaway inputs. */
  full: string;
};

export const SUMMARY_MAX = 160;
const SUMMARY_FULL_MAX = 4000;

const COMMAND_KEYS = [
  "command",
  "cmd",
  "commandline",
  "command_line",
  "script",
];
const ARGV_KEYS = ["argv", "command", "cmd"];
const PATH_KEYS = [
  "path",
  "file_path",
  "filepath",
  "absolutepath",
  "absolute_path",
  "targetfile",
  "target_file",
  "notebook_path",
  "file",
  "filename",
  "directorypath",
  "directory_path",
  "directory",
  "dir",
  "searchpath",
  "search_path",
  "uri",
];
const SEARCH_KEYS = ["pattern", "query", "regex", "searchpattern", "glob", "q"];
const URL_KEYS = ["url"];
const FALLBACK_KEYS = [
  "action",
  "description",
  "prompt",
  "task",
  "title",
  "name",
  "id",
];
const MCP_SERVER_KEYS = ["servername", "server_name", "server"];
const MCP_TOOL_KEYS = ["toolname", "tool_name", "tool"];
const MCP_ARGS_KEYS = ["arguments", "args", "input", "params", "parameters"];

const SEARCH_NAME = /grep|search|find|glob|query|lookup/i;
const MCP_NAME = /mcp/i;

type Fields = Map<string, unknown>;

function fieldsOf(input: Record<string, unknown>): Fields {
  const m: Fields = new Map();
  for (const [k, v] of Object.entries(input)) {
    const key = k.toLowerCase();
    if (!m.has(key)) m.set(key, v);
  }
  return m;
}

function str(f: Fields, keys: readonly string[]): string | null {
  for (const k of keys) {
    const v = f.get(k);
    if (typeof v === "string" && v.trim()) return v;
  }
  return null;
}

function quoteArg(a: string): string {
  if (a === "") return "''";
  if (/^[\w@%+=:,./-]+$/.test(a)) return a;
  return `'${a.replace(/'/g, `'\\''`)}'`;
}

function argv(f: Fields, keys: readonly string[]): string | null {
  for (const k of keys) {
    const v = f.get(k);
    if (
      Array.isArray(v) &&
      v.length > 0 &&
      v.every((a) => typeof a === "string")
    )
      return (v as string[]).map(quoteArg).join(" ");
  }
  return null;
}

function asObject(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v))
    return v as Record<string, unknown>;
  if (
    typeof v === "string" &&
    v.length <= 64 * 1024 &&
    v.trimStart().startsWith("{")
  ) {
    try {
      const parsed: unknown = JSON.parse(v);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
        return parsed as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return null;
}

function mcpSummary(toolName: string, f: Fields): string | null {
  const server = str(f, MCP_SERVER_KEYS);
  const tool = str(f, MCP_TOOL_KEYS);
  const named = MCP_NAME.test(toolName);
  if (!(server && tool) && !(named && (server || tool))) return null;
  const head = [server, tool].filter(Boolean).join("/");
  let action: string | null = null;
  for (const k of MCP_ARGS_KEYS) {
    const args = asObject(f.get(k));
    if (args) {
      action = str(fieldsOf(args), ["action"]);
      if (action) break;
    }
  }
  action ??= str(f, ["action"]);
  return action ? `${head} ${action}` : head;
}

function pathList(v: unknown): string | null {
  if (!Array.isArray(v) || v.length === 0) return null;
  const paths: string[] = [];
  for (const item of v) {
    const p =
      typeof item === "string"
        ? item
        : item && typeof item === "object"
          ? str(fieldsOf(item as Record<string, unknown>), PATH_KEYS)
          : null;
    if (p) paths.push(p);
  }
  if (paths.length === 0) return null;
  return paths.length === 1
    ? paths[0]
    : `${paths[0]} +${paths.length - 1} more`;
}

function searchSummary(f: Fields): string | null {
  const pattern = str(f, SEARCH_KEYS);
  if (!pattern) return null;
  const where = str(f, PATH_KEYS);
  return where ? `${pattern} in ${where}` : pattern;
}

function firstString(f: Fields): string | null {
  for (const v of f.values()) {
    if (typeof v === "string" && v.trim()) return v;
  }
  return null;
}

function rawSummary(toolName: string, input: unknown): string | null {
  if (typeof input === "string") return input.trim() ? input : null;
  if (Array.isArray(input)) return pathList(input);
  if (!input || typeof input !== "object") return null;
  const f = fieldsOf(input as Record<string, unknown>);

  const mcp = mcpSummary(toolName, f);
  if (mcp) return mcp;

  const command = str(f, COMMAND_KEYS) ?? argv(f, ARGV_KEYS);
  if (command) return command;

  if (SEARCH_NAME.test(toolName)) {
    const search = searchSummary(f);
    if (search) return search;
  }

  const path = str(f, PATH_KEYS);
  if (path) return path;

  const url = str(f, URL_KEYS);
  if (url) return url;

  const search = searchSummary(f);
  if (search) return search;

  for (const v of f.values()) {
    const list = pathList(v);
    if (list) return list;
  }

  return str(f, FALLBACK_KEYS) ?? firstString(f);
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function bound(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1).trimEnd()}…`;
}

/** Names the main argument of a tool call coming from a CLI agent, whose
 * tool names ("shell", "run_command") say nothing on their own. */
export function summarizeToolInput(
  toolName: string,
  input: unknown,
): ToolSummary | null {
  const raw = rawSummary(toolName, input);
  if (!raw) return null;
  const text = bound(oneLine(raw), SUMMARY_MAX);
  if (!text) return null;
  return { text, full: bound(raw.trim(), SUMMARY_FULL_MAX) };
}
