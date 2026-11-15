import { Text } from "@codemirror/state";
import { expect, it } from "vitest";
import { editorLocationOffset } from "@/modules/editor/lib/locationOffset";
it("uses one-based source locations and clamps to the selected line", () => {
  const doc = Text.of(["first", "e\u0301中😀 file", "last"]);
  expect(editorLocationOffset(doc, 2, 3)).toBe(8);
  expect(editorLocationOffset(doc, 2, 999)).toBe(doc.line(2).to);
  expect(editorLocationOffset(doc, 999, 1)).toBe(doc.line(3).from);
  expect(editorLocationOffset(doc, 0, 0)).toBe(0);
});
