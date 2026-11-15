import { expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { PaneTreeView } from "@/modules/terminal/PaneTreeView";
vi.mock("@/components/ui/resizable", () => ({
  ResizableHandle: "div",
  ResizablePanel: "div",
  ResizablePanelGroup: "div",
}));
vi.mock("@/modules/tabs", () => ({ paneDividerColor: () => "#888" }));
vi.mock("@/modules/terminal/TerminalPane", () => ({ TerminalPane: "div" }));
function leaf(activeLeafId: number, onFocusLeaf: (id: number) => void) {
  return PaneTreeView({
    node: { kind: "leaf", id: 11 },
    tabVisible: true,
    activeLeafId,
    blocks: true,
    onFocusLeaf,
    getBundle: () => ({
      setRef: vi.fn(),
      onSearchReady: vi.fn(),
      onCwd: vi.fn(),
      onExit: vi.fn(),
    }),
    onOpenFileLink: vi.fn(),
  }) as ReactElement<{
    onPointerDownCapture?: () => void;
    onFocus: () => void;
  }>;
}
it("activates an inactive block leaf during pointer capture before the grid can cancel default focus", () => {
  const activate = vi.fn();
  const element = leaf(22, activate);
  const capture = element.props.onPointerDownCapture;
  expect(capture).toBeTypeOf("function");
  if (!capture) throw new Error("Missing pointer capture");
  capture();
  expect(activate).toHaveBeenCalledExactlyOnceWith(11);
});
it("preserves keyboard focus activation without redundantly activating the current leaf", () => {
  const activate = vi.fn();
  leaf(22, activate).props.onFocus();
  expect(activate).toHaveBeenCalledExactlyOnceWith(11);
  activate.mockClear();
  const element = leaf(11, activate);
  element.props.onPointerDownCapture?.();
  element.props.onFocus();
  expect(activate).not.toHaveBeenCalled();
});
