import { expect, it } from "vitest";
import { decodeNativeState } from "@/modules/terminal/gl/nativeState";
const state = {
  version: 1,
  alternateScreen: false,
  mouseTracking: false,
  bracketedPaste: true,
  focusTracking: false,
  modifyOtherKeys: 2,
  kittyFlags: 0,
};
it("accepts only bounded protocol state and strips extra data", () => {
  expect(decodeNativeState({ ...state, ignored: "never expose" })).toEqual(
    state,
  );
});
it("rejects malformed flags and versions", () => {
  for (const value of [
    null,
    {},
    { ...state, version: -1 },
    { ...state, kittyFlags: 32 },
    { ...state, modifyOtherKeys: -1 },
    { ...state, alternateScreen: "true" },
  ])
    expect(() => decodeNativeState(value)).toThrow("invalid");
});
