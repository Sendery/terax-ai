import { history, undo, undoDepth } from "@codemirror/commands";
import {
  EditorSelection,
  EditorState,
  type Transaction,
} from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
  formatGraphJson,
  graphJsonDiagnostics,
  jsonFormatTransaction,
} from "./jsonEditing";

describe("GraphX JSON draft editing", () => {
  it("changes only whitespace, retaining large numbers, duplicates, escapes and order", () => {
    const source = String.raw` {"n":9007199254740993,"n":1e+100,"z":-0,"s":"a\u0062\"c","empty":[ ],"o":{"x":true}} `;
    const result = formatGraphJson(source);
    expect(result.error).toBeUndefined();
    expect(result.text).toBe(String.raw`{
  "n": 9007199254740993,
  "n": 1e+100,
  "z": -0,
  "s": "a\u0062\"c",
  "empty": [],
  "o": {
    "x": true
  }
}`);
    expect(formatGraphJson(result.text).changes).toEqual([]);
  });
  it.each([
    "",
    '{"x":1,}',
    '{\n  "x": }',
    '{"s":"\\x"}',
    "[01]",
    "[true false]",
    '{"x":"a\nb"}',
  ])("rejects invalid JSON without changing its draft: %s", (source) => {
    const result = formatGraphJson(source);
    expect(result.error).toMatch(/line \d+, column \d+/);
    expect(result.text).toBe(source);
    expect(result.changes).toEqual([]);
    expect(
      jsonFormatTransaction(EditorState.create({ doc: source })),
    ).toBeNull();
  });
  it("reports a stable 1-based syntax location and keeps schema errors distinct", () => {
    const source = '{\n  "x": }';
    expect(graphJsonDiagnostics(source)[0]).toMatchObject({
      from: 9,
      message: "Invalid JSON at line 2, column 8",
      source: "JSON",
    });
    expect(graphJsonDiagnostics("{}")[0]).toMatchObject({
      source: "GraphX",
      severity: "error",
    });
    expect(formatGraphJson("{}").error).toBeUndefined();
  });
  it("formats as one undo step, maps a backward selection, and isolates surrounding typing", () => {
    let state = EditorState.create({
      doc: '{"x":"selected"}',
      extensions: [history()],
    });
    const dispatch = (tr: Transaction) => {
      state = tr.state;
    };
    dispatch(
      state.update({
        changes: { from: 0, insert: " " },
        userEvent: "input.type",
      }),
    );
    const from = state.doc.toString().indexOf("selected");
    dispatch(
      state.update({ selection: EditorSelection.single(from + 8, from) }),
    );
    const before = state;
    const formatting = jsonFormatTransaction(state);
    expect(formatting).not.toBeNull();
    if (!formatting) throw new Error("Expected a formatting transaction");
    dispatch(formatting);
    expect(
      state.sliceDoc(state.selection.main.from, state.selection.main.to),
    ).toBe("selected");
    expect(state.selection.main.anchor).toBeGreaterThan(
      state.selection.main.head,
    );
    expect(undoDepth(state)).toBe(2);
    const formatted = state.doc.toString();
    dispatch(
      state.update({
        changes: { from: state.doc.length, insert: " " },
        userEvent: "input.type",
      }),
    );
    expect(undo({ state, dispatch })).toBe(true);
    expect(state.doc.toString()).toBe(formatted);
    expect(undo({ state, dispatch })).toBe(true);
    expect(state.doc.toString()).toBe(before.doc.toString());
    expect(state.selection.eq(before.selection)).toBe(true);
    expect(undo({ state, dispatch })).toBe(true);
    expect(state.doc.toString()).toBe('{"x":"selected"}');
  });
  it("leaves idempotent documents and bounded-limit failures untouched", () => {
    expect(jsonFormatTransaction(EditorState.create({ doc: "{}" }))).toBeNull();
    const source = `${"[".repeat(129)}0${"]".repeat(129)}`;
    expect(formatGraphJson(source)).toMatchObject({
      text: source,
      changes: [],
      error: expect.stringContaining("128"),
    });
  });
  it("keeps multiple selections and preserves the editor's final newline", () => {
    const source = '{"one":"first","two":"second"}\n';
    const a = source.indexOf("first"),
      b = source.indexOf("second");
    const state = EditorState.create({
      doc: source,
      selection: EditorSelection.create(
        [EditorSelection.range(a, a + 5), EditorSelection.range(b + 6, b)],
        1,
      ),
      extensions: [EditorState.allowMultipleSelections.of(true)],
    });
    const transaction = jsonFormatTransaction(state);
    if (!transaction) throw new Error("Expected a formatting transaction");
    const next = transaction.state;
    expect(
      next.selection.ranges.map((r) => next.sliceDoc(r.from, r.to)),
    ).toEqual(["first", "second"]);
    expect(next.selection.mainIndex).toBe(1);
    expect(next.doc.toString().endsWith("\n")).toBe(true);
  });
  it("bounds UTF-8 input before parsing and reports the existing schema limit separately", () => {
    const source = `"${"é".repeat(262144)}"`;
    expect(formatGraphJson(source)).toMatchObject({
      text: source,
      changes: [],
      error: expect.stringContaining("512 KiB"),
    });
    const large = JSON.stringify({
      nodes: [],
      edges: [],
      title: "a".repeat(50000),
    });
    expect(graphJsonDiagnostics(large)[0]).toMatchObject({
      source: "GraphX",
      message: expect.stringContaining("48 KiB"),
    });
    expect(formatGraphJson(large).error).toBeUndefined();
  });
  it("retains the existing GraphX semantic validation after formatting", () => {
    const source = '{"nodes":[{"id":"a","label":"A"}],"edges":[]}';
    expect(graphJsonDiagnostics(formatGraphJson(source).text)).toEqual([]);
    const bad =
      '{"nodes":[{"id":"a","label":"A"}],"edges":[{"id":"e","from":"a","to":"missing"}]}';
    expect(graphJsonDiagnostics(formatGraphJson(bad).text)[0]).toMatchObject({
      source: "GraphX",
      message: expect.stringContaining("Unknown GraphX reference"),
    });
  });
  it("bounds formatted UTF-8 bytes, including expanded Unicode drafts", () => {
    const source =
      "[".repeat(127) +
      Array(3000)
        .fill(`"${"é".repeat(64)}"`)
        .join(",") +
      "]".repeat(127);
    expect(formatGraphJson(source)).toMatchObject({
      text: source,
      changes: [],
      error: expect.stringContaining("1 MiB"),
    });
  });
});
