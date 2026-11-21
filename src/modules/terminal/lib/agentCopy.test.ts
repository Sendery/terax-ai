import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

import { useAgentActivityStore } from "./agentActivity";
import {
  rejoinWrappedParagraphs,
  selectionCopyChoices,
  terminalCopyText,
  terminalDisplayWidth,
} from "./agentCopy";

/** Greedy word wrap the way Ink lays a paragraph out: hard newlines, the
 *  first row after `lead`, the rest indented to the text column. */
function wrap(text: string, cols: number, lead: string, indent: number) {
  const rows: string[] = [];
  let row = lead;
  let empty = true;
  for (const word of text.split(" ")) {
    const next = empty ? row + word : `${row} ${word}`;
    if (!empty && terminalDisplayWidth(next) > cols) {
      rows.push(row);
      row = " ".repeat(indent) + word;
    } else {
      row = next;
    }
    empty = false;
  }
  rows.push(row);
  return rows.join("\n");
}

const NOTICE =
  'sample-plugin: its build.check hook was skipped. "sample-plugin-defaults" runs first and sent the event on past it.';
const ANSWER =
  "Your loop printed line-1 through line-70 with nothing on stderr, so it ran cleanly.";
const DETAIL =
  "Separately, a background notice says the sample plugin's build.check hook was skipped because sample-plugin-defaults runs before it and passed the event along. I don't need to do anything about it. If you expected the sample plugin to run there, look at how your plugin hooks are ordered.";
const ITEM_ONE =
  "Check the order of the hooks in the settings file and move the sample plugin above the defaults so it sees the event first.";
const ITEM_TWO = "Run the loop again.";
const PROMPT =
  "explain the repository layout in detail please, with examples of every folder and what it contains and why";

/** A Claude Code screen as Select All copies it: banner, a tool call with its
 *  output, a notice that wraps short of the edge, an answer with paragraphs
 *  and a list, the input box and the status rows. */
function claudeCodeScreen(cols: number, wrapped: boolean) {
  const para = (text: string, width: number, lead: string, indent: number) =>
    wrapped ? wrap(text, width, lead, indent) : lead + text;
  const rule = "─".repeat(cols);
  return [
    " ▐▛███▜▌   Sample Code v1.0.0",
    "▝▜█████▛▘  Model with high effort · Team",
    "  ▘▘ ▝▝    /…/projects/sample",
    "",
    "❯ print seventy lines",
    "",
    "⏺ Bash(for i in $(seq 1 70); do echo line-$i; done)",
    "  ⎿  line-1",
    "     line-2",
    "     line-3",
    "     … +67 lines (ctrl+o to expand)",
    "",
    para(NOTICE, cols - 9, "⏺ ", 2),
    "",
    para(ANSWER, cols, "⏺ ", 2),
    "",
    para(DETAIL, cols, "  ", 2),
    "",
    para(ITEM_ONE, cols, "  1. ", 5),
    para(ITEM_TWO, cols, "  2. ", 5),
    "",
    "  What would you like to do next?",
    "",
    "✻ Baked for 3s · done 7:59 PM",
    "",
    rule,
    para(PROMPT, cols - 2, "❯ ", 2),
    rule,
    `  ⚠ Transcript saving is off ${"x".repeat(cols - 31)}…`,
    `  📂 /sample/projects/${"y".repeat(cols - 24)}…`,
    "  ⏵⏵ auto mode on (shift+tab to cycle)",
    `${" ".repeat(cols - 44)}Update available! Run: brew upgrade sample`,
  ].join("\n");
}

describe("rejoinWrappedParagraphs", () => {
  it.each([100, 60])(
    "rejoins a Claude Code screen wrapped at %i columns",
    (cols) => {
      const shown = claudeCodeScreen(cols, true);
      expect(shown.split("\n").length).toBeGreaterThan(
        claudeCodeScreen(cols, false).split("\n").length,
      );
      expect(rejoinWrappedParagraphs(shown, { cols })).toBe(
        claudeCodeScreen(cols, false),
      );
    },
  );

  it.each([40, 60, 80, 100, 132])(
    "restores a paragraph wrapped at %i columns",
    (cols) => {
      const shown = `${wrap(ANSWER, cols, "⏺ ", 2)}\n\n${wrap(DETAIL, cols, "  ", 2)}`;
      expect(rejoinWrappedParagraphs(shown, { cols })).toBe(
        `⏺ ${ANSWER}\n\n  ${DETAIL}`,
      );
    },
  );

  it("keeps a break the author wrote: the next word would have fit", () => {
    const shown = [
      "⏺ Roses are red,",
      "  violets are blue,",
      "  this line ends early.",
      "",
      "  Regards,",
      "  The sample team",
    ].join("\n");
    expect(rejoinWrappedParagraphs(shown, { cols: 80 })).toBe(shown);
  });

  it("leaves a block with several written breaks alone, wrapped rows too", () => {
    const cols = 50;
    const shown = [
      "⏺ Here is the script:",
      "",
      "  import sample",
      "  result = sample.fetch_something(argument_one, two)",
      "  print(result)",
      "  sample.close()",
    ].join("\n");
    expect(rejoinWrappedParagraphs(shown, { cols })).toBe(shown);
  });

  it("joins only the forced breaks inside one paragraph", () => {
    const shown = [
      "⏺ First sentence stops here.",
      "  The second one is long enough that the program had to wrap it at the",
      "  edge of the pane.",
    ].join("\n");
    expect(rejoinWrappedParagraphs(shown, { cols: 72 })).toBe(
      [
        "⏺ First sentence stops here.",
        "  The second one is long enough that the program had to wrap it at the edge of the pane.",
      ].join("\n"),
    );
  });

  it("keeps list items apart and rejoins each one", () => {
    const cols = 50;
    const shown = [
      "⏺ Steps:",
      "",
      wrap(ITEM_ONE, cols, "  - ", 4),
      wrap(ITEM_ONE, cols, "  - ", 2),
      wrap(ITEM_ONE, cols, "  • ", 4),
      wrap(ITEM_ONE, cols, "  10. ", 6),
      "  - short",
      "  - items",
    ].join("\n");
    expect(rejoinWrappedParagraphs(shown, { cols })).toBe(
      [
        "⏺ Steps:",
        "",
        `  - ${ITEM_ONE}`,
        `  - ${ITEM_ONE}`,
        `  • ${ITEM_ONE}`,
        `  10. ${ITEM_ONE}`,
        "  - short",
        "  - items",
      ].join("\n"),
    );
  });

  it("leaves tool output as printed, even rows that reach the edge", () => {
    const cols = 40;
    const shown = [
      "⏺ Bash(cat notes.txt)",
      `  ⎿  ${"a".repeat(30)} bb`,
      `     ${"c".repeat(30)} dd`,
      "",
      `     ${"e".repeat(30)} ff`,
      `     ${"g".repeat(30)} hh`,
      "",
      wrap(DETAIL, cols, "⏺ ", 2),
    ].join("\n");
    const copied = rejoinWrappedParagraphs(shown, { cols }).split("\n");
    expect(copied.slice(0, 7)).toEqual(shown.split("\n").slice(0, 7));
    expect(copied[7]).toBe(`⏺ ${DETAIL}`);
  });

  it("leaves fenced code and code indented under the text", () => {
    const cols = 40;
    const code = [
      `const first = compute(${"a".repeat(14)});`,
      `const second = compute(${"b".repeat(13)}) +`,
      `first.someLongPropertyNameHere.value`,
    ];
    const shown = [
      "⏺ Fenced:",
      "  ```ts",
      ...code.map((row) => `  ${row}`),
      "  ```",
      "  Indented:",
      ...code.map((row) => `      ${row}`),
    ].join("\n");
    expect(rejoinWrappedParagraphs(shown, { cols })).toBe(shown);
  });

  it("does not join after a line that ends like code", () => {
    const cols = 40;
    const shown = [
      "⏺ Run this:",
      "",
      `  const value = compute(${"a".repeat(11)});`,
      `  export function handler(event) {`,
      `  ${"x".repeat(30)} &&`,
      `  ${"y".repeat(30)} \\`,
      `  ${"z".repeat(34)}`,
    ].join("\n");
    expect(rejoinWrappedParagraphs(shown, { cols })).toBe(shown);
  });

  it("leaves tables, boxes, menus in columns and truncated rows", () => {
    const cols = 60;
    const shown = [
      "╭──────────────────────────────────────────────────────────╮",
      "│ Do you trust the files in this folder? They can run code │",
      "│ on this machine when the session starts, so check first. │",
      "╰──────────────────────────────────────────────────────────╯",
      "  | name | value that is long enough to reach the margin |",
      "  | more | another value long enough to reach the margin |",
      "    /first-command          Describes what the first one does",
      "    /second-command         Describes what the second one does",
      `  Status ${"x".repeat(48)}…`,
      `  another row that follows the truncated one closely here`,
    ].join("\n");
    expect(rejoinWrappedParagraphs(shown, { cols })).toBe(shown);
  });

  it("measures wide characters as two columns", () => {
    expect(terminalDisplayWidth("⏺ ab")).toBe(4);
    expect(terminalDisplayWidth("日本語")).toBe(6);
    expect(terminalDisplayWidth("📂 a")).toBe(4);
    expect(terminalDisplayWidth("\u26A0\uFE0F")).toBe(2);
    expect(terminalDisplayWidth("⚠")).toBe(1);
    expect(terminalDisplayWidth("e\u0301")).toBe(1);
    expect(terminalDisplayWidth("\u{1F469}\u200D\u{1F4BB}")).toBe(2);
    // 14 wide glyphs fill 30 columns with the lead; "more" would have fit by
    // character count but not by width.
    const shown = `⏺ ${"語".repeat(13)} 語\n  more text`;
    expect(rejoinWrappedParagraphs(shown, { cols: 30 })).toBe(
      `⏺ ${"語".repeat(13)} 語 more text`,
    );
    expect(
      rejoinWrappedParagraphs(`⏺ ${"a".repeat(13)} a\n  more text`, {
        cols: 30,
      }),
    ).toBe(`⏺ ${"a".repeat(13)} a\n  more text`);
  });

  it("joins CJK text and a token cut at the edge without a space", () => {
    expect(
      rejoinWrappedParagraphs(`⏺ ${"語".repeat(14)}\n  ${"語".repeat(5)}`, {
        cols: 30,
      }),
    ).toBe(`⏺ ${"語".repeat(19)}`);
    const url = `https://example.com/${"a".repeat(50)}`;
    // wrap-ansi starts a token longer than the row on the current one.
    const shown = [
      `⏺ See the page: ${url.slice(0, 24)}`,
      `  ${url.slice(24, 62)}`,
      `  ${url.slice(62)} for details.`,
    ].join("\n");
    expect(shown.split("\n")[0]).toHaveLength(40);
    expect(rejoinWrappedParagraphs(shown, { cols: 40 })).toBe(
      `⏺ See the page: ${url} for details.`,
    );
    // A row that an ordinary word happens to fill still gets its space.
    const full = `⏺ ${"word ".repeat(7)}end\n  ${"word ".repeat(7)}end\n  tail`;
    expect(full.split("\n")[0]).toHaveLength(40);
    expect(rejoinWrappedParagraphs(full, { cols: 40 })).toBe(
      `⏺ ${"word ".repeat(7)}end ${"word ".repeat(7)}end tail`,
    );
  });

  it("rejoins history that was wrapped for a wider pane", () => {
    const shown = wrap(DETAIL, 100, "⏺ ", 2);
    expect(rejoinWrappedParagraphs(shown, { cols: 60 })).toBe(`⏺ ${DETAIL}`);
    // Short rows next to it still read as written breaks.
    const lines = "⏺ one two three four five six seven.\n  next";
    expect(rejoinWrappedParagraphs(lines, { cols: 60 })).toBe(lines);
  });

  it("rejoins a selection that starts in the middle of a row", () => {
    const rows = wrap(DETAIL, 60, "  ", 2).split("\n");
    for (const from of [30, 31]) {
      // From a space between two words, and from the first letter of one.
      const tail = rows[1].slice(from);
      const fromMiddle = [tail, ...rows.slice(2)].join("\n");
      expect(rejoinWrappedParagraphs(fromMiddle, { cols: 60 })).toBe(
        DETAIL.slice(DETAIL.indexOf(tail.trim()) - (31 - from)),
      );
      const twoRows = [tail, rows[2].slice(0, 20)].join("\n");
      expect(rejoinWrappedParagraphs(twoRows, { cols: 60 })).toBe(
        `${tail} ${rows[2].slice(2, 20)}`,
      );
    }
  });

  it("does not guess when a partial first row leads into tool output", () => {
    for (const shown of [
      "ine-1\n     line-2\n     line-3",
      "ine-1\n     line-2\n     line-3\n     line-4\n     line-5",
    ])
      expect(rejoinWrappedParagraphs(shown, { cols: 60 })).toBe(shown);
    const two = "ine-1\n     line-2";
    expect(rejoinWrappedParagraphs(two, { cols: 60 })).toBe(two);
  });

  it("returns the same text when there is nothing to do", () => {
    for (const text of ["", "one line", "a\r\nb", "a\n\nb"])
      expect(rejoinWrappedParagraphs(text, { cols: 80 })).toBe(text);
    const shown = wrap(DETAIL, 60, "⏺ ", 2);
    for (const cols of [0, 10, Number.NaN])
      expect(rejoinWrappedParagraphs(shown, { cols })).toBe(shown);
  });
});

describe("selectionCopyChoices", () => {
  const rows = wrap(DETAIL, 60, "  ", 2);
  const rejoin = (text: string) => rejoinWrappedParagraphs(text, { cols: 60 });

  it("offers the rejoined text and the text as shown when they differ", () => {
    expect(selectionCopyChoices(rows, rejoin)).toEqual({
      shown: rows.trim(),
      copied: DETAIL,
    });
  });

  it("offers one text when nothing was rejoined or no pane rule applies", () => {
    expect(selectionCopyChoices("  one\n  two\n", rejoin)).toEqual({
      shown: "one\n  two",
      copied: "one\n  two",
    });
    expect(selectionCopyChoices(rows)).toEqual({
      shown: rows.trim(),
      copied: rows.trim(),
    });
    expect(selectionCopyChoices(null, rejoin)).toEqual({
      shown: "",
      copied: "",
    });
  });
});

describe("terminalCopyText", () => {
  const shown = wrap(DETAIL, 60, "⏺ ", 2);
  beforeEach(() => useAgentActivityStore.setState({ phases: {}, reasons: {} }));

  it("never changes text copied from a pane with no agent", () => {
    expect(terminalCopyText(shown, { ptyId: 7, cols: 60 })).toBe(shown);
    expect(terminalCopyText(shown, { ptyId: null, cols: 60 })).toBe(shown);
  });

  it("rejoins while an agent runs in the pane, and stops when it exits", () => {
    useAgentActivityStore.getState().setPhase(7, "working");
    expect(terminalCopyText(shown, { ptyId: 7, cols: 60 })).toBe(`⏺ ${DETAIL}`);
    expect(terminalCopyText(shown, { ptyId: 8, cols: 60 })).toBe(shown);
    useAgentActivityStore.getState().setPhase(7, "idle");
    expect(terminalCopyText(shown, { ptyId: 7, cols: 60 })).toBe(`⏺ ${DETAIL}`);
    useAgentActivityStore.getState().clear(7);
    expect(terminalCopyText(shown, { ptyId: 7, cols: 60 })).toBe(shown);
  });
});
