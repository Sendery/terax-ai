import { createSelectionPopup } from "@/modules/ai/hooks/selectionPopup";
import type { TerminalSelectionGesture } from "@/modules/terminal/lib/selectionGesture";
import { expect, it, vi } from "vitest";

function fixture() {
  let text: string | null = "owned native text";
  let owner = true;
  const show = vi.fn();
  const deferred: (() => void)[] = [];
  const popup = createSelectionPopup({
    readSelection: () => text,
    show,
    defer: (run) => deferred.push(run),
  });
  const pending = () => {
    let resolve!: (text: string | null) => void;
    let reject!: (error: unknown) => void;
    const gesture: TerminalSelectionGesture = {
      x: 120,
      y: 80,
      current: () => owner,
      selection: new Promise((yes, no) => {
        resolve = yes;
        reject = no;
      }),
    };
    return { gesture, resolve, reject };
  };
  return {
    popup,
    show,
    pending,
    deferred,
    text: (value: string | null) => {
      text = value;
    },
    retire: () => {
      owner = false;
    },
  };
}
it("waits for native completion and rechecks the same selected text before acting", async () => {
  const f = fixture(),
    pending = f.pending(),
    action = vi.fn();
  f.popup.native(pending.gesture);
  expect(f.show).toHaveBeenLastCalledWith(null);
  pending.resolve("owned native text");
  await pending.gesture.selection;
  expect(f.show).toHaveBeenLastCalledWith({ x: 120, y: 80 });
  f.text("replacement text");
  f.popup.act(action);
  expect(action).not.toHaveBeenCalled();
  expect(f.show).toHaveBeenLastCalledWith(null);
});
it("allows each native selection action while its original owner remains current", async () => {
  const f = fixture(),
    pending = f.pending(),
    action = vi.fn();
  f.popup.native(pending.gesture);
  pending.resolve("owned native text");
  await pending.gesture.selection;
  f.popup.act(action);
  expect(action).toHaveBeenCalledTimes(1);
});
it.each(["outside-pointer", "retired", "disposed"] as const)(
  "does not reopen a native popup after %s",
  async (change) => {
    const f = fixture(),
      pending = f.pending();
    f.popup.native(pending.gesture);
    if (change === "outside-pointer") f.popup.dismiss();
    if (change === "retired") f.retire();
    if (change === "disposed") f.popup.dispose();
    pending.resolve("owned native text");
    await pending.gesture.selection;
    expect(f.show.mock.calls.every(([position]) => position === null)).toBe(
      true,
    );
  },
);
it.each(["resolve", "reject"] as const)(
  "does not let an older %s clear a newer selection popup",
  async (result) => {
    const f = fixture(),
      old = f.pending(),
      current = f.pending();
    f.popup.native(old.gesture);
    f.popup.native(current.gesture);
    current.resolve("owned native text");
    await current.gesture.selection;
    const shown = f.show.mock.calls.length;
    if (result === "resolve") old.resolve("old selection");
    else old.reject(new Error("old owner closed"));
    await old.gesture.selection.catch(() => null);
    expect(f.show).toHaveBeenCalledTimes(shown);
    expect(f.show).toHaveBeenLastCalledWith({ x: 120, y: 80 });
  },
);
it.each([null, "", "   "])(
  "does not show actions for empty native selection %j",
  async (text) => {
    const f = fixture(),
      pending = f.pending();
    f.text(text);
    f.popup.native(pending.gesture);
    pending.resolve(text);
    await pending.gesture.selection;
    expect(f.show).toHaveBeenLastCalledWith(null);
  },
);
it("does not show actions for an unavailable native selection", async () => {
  const f = fixture(),
    pending = f.pending();
  f.popup.native(pending.gesture);
  pending.reject(new Error("unavailable"));
  await pending.gesture.selection.catch(() => null);
  expect(f.show).toHaveBeenLastCalledWith(null);
});
it("preserves legacy/editor deferral and rejects an old deferred reply after dismissal", () => {
  const f = fixture(),
    action = vi.fn();
  f.popup.legacy({ x: 1, y: 2 });
  expect(f.show).not.toHaveBeenCalled();
  f.deferred.shift()?.();
  expect(f.show).toHaveBeenLastCalledWith({ x: 1, y: 2 });
  f.popup.act(action);
  expect(action).toHaveBeenCalledTimes(1);
  f.popup.legacy({ x: 3, y: 4 });
  f.popup.dismiss();
  f.deferred.shift()?.();
  expect(f.show).toHaveBeenLastCalledWith(null);
});

it("only permits one action from a displayed native popup, including its closing animation", async () => {
  const f = fixture(),
    pending = f.pending(),
    action = vi.fn();
  f.popup.native(pending.gesture);
  pending.resolve("owned native text");
  await pending.gesture.selection;
  f.popup.act(action);
  f.popup.act(action);
  expect(action).toHaveBeenCalledTimes(1);
});
