import { describe, expect, it } from "vitest";
import {
  applyRenderableView,
  fileRenderKind,
  resolveViewMode,
} from "@/modules/renderable/viewMode";
import type { Tab } from "@/modules/tabs";

describe("renderable views", () => {
  it("changes presentation without changing file identity or dirty metadata", () => {
    const tab = {
      id: 1,
      kind: "editor",
      spaceId: "s",
      title: "file",
      path: "/file.html",
      dirty: true,
      preview: false,
      notes: [],
      customTitle: "mine",
    } satisfies Tab;
    for (const mode of ["raw", "rendered", "side-by-side"] as const) {
      expect(applyRenderableView(tab, mode)).toEqual({
        ...tab,
        viewMode: mode,
      });
    }
  });
  it("normalizes absent and corrupt modes without converting document kinds", () => {
    expect(resolveViewMode({ kind: "markdown" })).toBe("rendered");
    expect(resolveViewMode({ kind: "mermaid" })).toBe("side-by-side");
    expect(resolveViewMode({ kind: "graphx" })).toBe("rendered");
    for (const viewMode of [undefined, null, "split", {}, 1])
      expect(resolveViewMode({ kind: "editor", viewMode })).toBe("raw");
  });
  it("detects supported source formats only, across path separators and case", () => {
    expect(fileRenderKind("C:\\docs\\INDEX.HTML")).toBe("html");
    expect(fileRenderKind("/doc.htm")).toBe("html");
    expect(fileRenderKind("/doc.md")).toBe("markdown");
    expect(fileRenderKind("/doc.mmd")).toBe("mermaid");
    expect(fileRenderKind("/doc.graphx")).toBe("graphx");
    for (const path of ["/file.ts", "/file.json", "/image.svg", "/data.csv"])
      expect(fileRenderKind(path)).toBeNull();
  });
  it("rejects invalid transitions and nonrenderable files", () => {
    const tab = {
      id: 1,
      kind: "editor",
      spaceId: "s",
      title: "file",
      path: "/file.ts",
      dirty: true,
      preview: false,
    } satisfies Tab;
    expect(applyRenderableView(tab, "rendered")).toBe(tab);
    expect(
      applyRenderableView({ ...tab, path: "/file.html" }, "bogus" as never)
        .viewMode,
    ).toBeUndefined();
  });
});
