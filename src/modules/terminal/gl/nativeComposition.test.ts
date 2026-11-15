import { expect, it } from "vitest";
import { createNativeComposition } from "@/modules/terminal/gl/nativeComposition";

function key(value: string, type = "keydown", isComposing = false) {
  return {
    type,
    key: value,
    keyCode: isComposing ? 229 : 13,
    isComposing,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
  };
}
it("commits CJK once and swallows its confirming Enter until key release", () => {
  const state = createNativeComposition();
  state.start();
  state.onKey(key("Enter", "keydown", true));
  expect(state.end("\u6f22")).toBe("\u6f22");
  expect(state.onKey(key("Enter"))).toEqual({ kind: "swallow" });
  expect(
    state.takeInput(
      {
        inputType: "insertFromComposition",
        data: "\u6f22",
        isComposing: false,
      },
      "\u6f22",
    ),
  ).toBeNull();
  state.onKey(key("Enter", "keyup"));
  state.finishTurn();
  expect(state.onKey(key("Enter"))).toEqual({ kind: "pass" });
});
it("lets a new Enter submit after composition ended by a pointer action", () => {
  const state = createNativeComposition();
  state.start();
  state.end("\u65e5");
  state.finishTurn();
  expect(state.onKey(key("Enter"))).toEqual({ kind: "pass" });
});
it("preserves the existing WebKit dead-key correction without duplicating its text", () => {
  const state = createNativeComposition();
  state.onKey(key("Dead"));
  state.start();
  expect(state.end("~")).toBe("~");
  expect(state.onKey(key("~/"))).toEqual({ kind: "swallow" });
  expect(
    state.takeInput(
      { inputType: "insertText", data: "/", isComposing: false },
      "/",
    ),
  ).toBe("/");
});
it("keeps the dead-key control-key correction", () => {
  const state = createNativeComposition();
  state.onKey(key("Dead"));
  state.start();
  state.end("~");
  expect(state.onKey(key("~\r"))).toEqual({ kind: "send", data: "\r" });
});
it("does not send interim composition input and accepts normal virtual-keyboard text", () => {
  const state = createNativeComposition();
  state.start();
  expect(
    state.takeInput(
      { inputType: "insertCompositionText", data: "n", isComposing: true },
      "n",
    ),
  ).toBeNull();
  state.end("\u00f1");
  state.finishTurn();
  state.onKey(key("x"));
  expect(
    state.takeInput(
      { inputType: "insertText", data: "x", isComposing: false },
      "x",
    ),
  ).toBe("x");
});
