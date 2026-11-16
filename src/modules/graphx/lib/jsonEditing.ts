import { isolateHistory } from "@codemirror/commands";
import { json, jsonLanguage } from "@codemirror/lang-json";
import { type Diagnostic, linter } from "@codemirror/lint";
import {
  type ChangeSpec,
  type EditorState,
  Transaction,
} from "@codemirror/state";
import { parseGraphSource } from "./document";

// Editing can temporarily exceed the 48 KiB GraphX schema limit. Bound the
// synchronous editor helpers without truncating or replacing that draft.
const MAX_EDIT_BYTES = 512 * 1024;
const MAX_FORMAT_DEPTH = 128;
const MAX_FORMAT_LENGTH = 1024 * 1024;
export const JSON_FORMAT_EVENT = "input.format.graphx";

function syntaxDiagnostic(source: string): Diagnostic | undefined {
  if (
    source.length > MAX_EDIT_BYTES ||
    new TextEncoder().encode(source).length > MAX_EDIT_BYTES
  ) {
    return {
      from: 0,
      to: 0,
      severity: "error",
      source: "JSON",
      message:
        "JSON editing tools are limited to 512 KiB; the draft is unchanged",
    };
  }
  // The installed Lezer JSON grammar gives consistent offsets in WebKit and
  // Node, unlike engine-specific JSON.parse error messages. It never converts
  // numeric literals or duplicate properties into JavaScript values.
  let diagnostic: Diagnostic | undefined;
  jsonLanguage.parser.parse(source).iterate({
    enter(node) {
      if (diagnostic) return false;
      if (!node.type.isError) return;
      const from = Math.min(node.from, source.length);
      const prefix = source.slice(0, from);
      const line = prefix.split("\n").length;
      const column = from - prefix.lastIndexOf("\n");
      diagnostic = {
        from,
        to: Math.min(source.length, Math.max(from + 1, node.to)),
        severity: "error",
        source: "JSON",
        message: `Invalid JSON at line ${line}, column ${column}`,
      };
      return false;
    },
  });
  return diagnostic;
}

export function graphJsonDiagnostics(source: string): Diagnostic[] {
  const syntax = syntaxDiagnostic(source);
  if (syntax) return [syntax];
  try {
    parseGraphSource(source);
    return [];
  } catch (error) {
    return [
      {
        from: 0,
        to: 0,
        severity: "error",
        source: "GraphX",
        message: `JSON syntax valid. ${error instanceof Error ? error.message : "Invalid GraphX document"}`,
      },
    ];
  }
}

export function graphJsonExtensions() {
  return [
    json(),
    linter((view) => graphJsonDiagnostics(view.state.doc.toString()), {
      delay: 300,
    }),
  ];
}

type FormatResult = { text: string; changes: ChangeSpec[]; error?: string };
export function formatGraphJson(source: string): FormatResult {
  const unchanged = (error: string): FormatResult => ({
    text: source,
    changes: [],
    error,
  });
  const diagnostic = syntaxDiagnostic(source);
  if (diagnostic) return unchanged(diagnostic.message);
  // Strict syntax was checked above. Keep every lexical token verbatim and
  // edit only its preceding whitespace; CodeMirror maps selection through the
  // individual gaps, including backward and multiple selections.
  const tokens = [
    ...source.matchAll(
      /"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}[\]:,]/g,
    ),
  ];
  const changes: ChangeSpec[] = [];
  const output: string[] = [];
  let depth = 0;
  let end = 0;
  let length = 0;
  let previous = "";
  for (const match of tokens) {
    const token = match[0];
    const closing = token === "}" || token === "]";
    const empty =
      (previous === "{" && token === "}") ||
      (previous === "[" && token === "]");
    if (closing) depth--;
    let gap = "";
    if (previous === ":") gap = " ";
    else if (
      !empty &&
      (closing || previous === "," || previous === "{" || previous === "[")
    )
      gap = `\n${"  ".repeat(depth)}`;
    const from = match.index;
    if (source.slice(end, from) !== gap)
      changes.push({ from: end, to: from, insert: gap });
    output.push(gap, token);
    length += gap.length + token.length;
    if (length > MAX_FORMAT_LENGTH)
      return unchanged("Formatted JSON exceeds 1 MiB; the draft is unchanged");
    end = from + token.length;
    previous = token;
    if (token === "{" || token === "[") depth++;
    if (depth > MAX_FORMAT_DEPTH)
      return unchanged(
        "JSON formatting supports at most 128 nesting levels; the draft is unchanged",
      );
  }
  // Preserve an existing final newline, using the editor's LF convention.
  const trailing = /\r?\n[\t \r\n]*$/.test(source.slice(end)) ? "\n" : "";
  if (source.slice(end) !== trailing)
    changes.push({ from: end, to: source.length, insert: trailing });
  output.push(trailing);
  const text = output.join("");
  if (new TextEncoder().encode(text).length > MAX_FORMAT_LENGTH) {
    return unchanged("Formatted JSON exceeds 1 MiB; the draft is unchanged");
  }
  return { text, changes };
}

export function jsonFormatTransaction(
  state: EditorState,
  result: FormatResult = formatGraphJson(state.doc.toString()),
): Transaction | null {
  if (result.error || !result.changes.length) return null;
  return state.update({
    changes: result.changes,
    annotations: [
      Transaction.userEvent.of(JSON_FORMAT_EVENT),
      isolateHistory.of("full"),
    ],
    scrollIntoView: true,
  });
}
