import { expect, it } from "vitest";
import {
  nativeKeyEvent,
  nativeClipboardAction,
  nativeReadlineSequence,
  type NativeKeyboardEvent,
} from "@/modules/terminal/gl/nativeKeyboard";

function key(
  overrides: Partial<NativeKeyboardEvent> = {},
): NativeKeyboardEvent {
  return {
    type: "keydown",
    code: "KeyA",
    key: "a",
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    isComposing: false,
    keyCode: 65,
    repeat: false,
    getModifierState: () => false,
    ...overrides,
  };
}

it("preserves committed printable text and physical identity", () => {
  expect(
    nativeKeyEvent(key({ key: "\u00f1", code: "Semicolon" }), false),
  ).toMatchObject({
    code: "Semicolon",
    text: "\u00f1",
    action: "press",
    unshifted: "\u00f1",
    mods: 0,
  });
});
it("sends named keys and releases to the native encoder", () => {
  expect(
    nativeKeyEvent(key({ key: "Enter", code: "Enter", shiftKey: true }), false),
  ).toMatchObject({ code: "Enter", action: "press", mods: 1 });
  expect(nativeKeyEvent(key({ type: "keyup" }), false)).toMatchObject({
    code: "KeyA",
    action: "release",
  });
  expect(nativeKeyEvent(key({ repeat: true }), false)).toMatchObject({
    action: "repeat",
  });
});
it("leaves IME and dead keys to the textarea composition path", () => {
  for (const input of [
    key({ isComposing: true }),
    key({ keyCode: 229 }),
    key({ key: "Dead" }),
    key({ key: "Process" }),
  ])
    expect(nativeKeyEvent(input, false)).toBeNull();
});
it("keeps app and system clipboard shortcuts outside terminal encoding", () => {
  expect(nativeKeyEvent(key({ metaKey: true }), true)).toBeNull();
  for (const value of ["c", "v"])
    expect(
      nativeKeyEvent(key({ ctrlKey: true, shiftKey: true, key: value }), false),
    ).toBeNull();
  expect(
    nativeKeyEvent(key({ ctrlKey: true, key: "c", code: "KeyC" }), false),
  ).toMatchObject({ code: "KeyC", mods: 4, consumedMods: 0 });
});
it("marks AltGraph layout modifiers as consumed while retaining Unicode text", () => {
  expect(
    nativeKeyEvent(
      key({
        key: "@",
        code: "Digit2",
        ctrlKey: true,
        altKey: true,
        getModifierState: (name) => name === "AltGraph",
      }),
      false,
    ),
  ).toMatchObject({ text: "@", mods: 6, consumedMods: 6 });
});
it("uses Unidentified for browser input without a physical code", () => {
  expect(nativeKeyEvent(key({ code: "", key: "\u65e5" }), false)).toMatchObject(
    { code: "Unidentified", text: "\u65e5" },
  );
});

it("does not mislabel a shifted symbol as its unshifted codepoint", () => {
  expect(
    nativeKeyEvent(key({ key: "!", code: "Digit1", shiftKey: true }), false)
      ?.unshifted,
  ).toBeUndefined();
});

it("retains normal readline shortcuts without overriding negotiated TUI keys", () => {
  const normal = { alternateScreen: false, kittyFlags: 0, modifyOtherKeys: 0 };
  const left = key({ key: "ArrowLeft", code: "ArrowLeft", metaKey: true });
  expect(nativeReadlineSequence(left, true, normal)).toBe("\x01");
  expect(
    nativeReadlineSequence(
      key({ key: "Backspace", code: "Backspace", altKey: true }),
      true,
      normal,
    ),
  ).toBe("\x17");
  for (const mode of [
    { ...normal, alternateScreen: true },
    { ...normal, kittyFlags: 1 },
    { ...normal, modifyOtherKeys: 2 },
  ])
    expect(nativeReadlineSequence(left, true, mode)).toBeNull();
});

it("reserves platform Insert clipboard shortcuts without swallowing modified terminal keys", () => {
  const insert = key({ key: "Insert", code: "Insert" });
  for (const [event, action] of [
    [{ ...insert, ctrlKey: true }, "copy"],
    [{ ...insert, shiftKey: true }, "paste"],
  ] as const) {
    expect(nativeClipboardAction(event, false)).toBe(action);
    expect(nativeKeyEvent(event, false)).toBeNull();
    expect(nativeClipboardAction(event, true)).toBeNull();
  }
  expect(
    nativeClipboardAction({ ...insert, ctrlKey: true, shiftKey: true }, false),
  ).toBeNull();
  expect(
    nativeClipboardAction(
      key({ key: "v", ctrlKey: true, shiftKey: true, altKey: true }),
      false,
    ),
  ).toBeNull();
});
