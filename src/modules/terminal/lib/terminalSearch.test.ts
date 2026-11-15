import { expect, it, vi } from "vitest";
import {
  decorateTerminalSearch,
  TERMINAL_SEARCH_DECORATIONS,
} from "@/modules/terminal/lib/terminalSearch";

it("preserves the legacy decorations and stable identity through pane remounts", () => {
  const addon = {
    findNext: vi.fn(() => true),
    findPrevious: vi.fn(() => false),
    clearDecorations: vi.fn(),
  };
  const search = decorateTerminalSearch(addon);
  expect(decorateTerminalSearch(addon)).toBe(search);
  expect(search.findNext("needle", { incremental: true })).toBe(true);
  expect(search.findPrevious("needle")).toBe(false);
  expect(addon.findNext).toHaveBeenCalledWith("needle", {
    incremental: true,
    decorations: TERMINAL_SEARCH_DECORATIONS,
  });
  expect(addon.findPrevious).toHaveBeenCalledWith("needle", {
    decorations: TERMINAL_SEARCH_DECORATIONS,
  });
  search.clearDecorations();
  expect(addon.clearDecorations).toHaveBeenCalledOnce();
});
