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
  cwd: null,
  shellReady: false,
  commandRunning: false,
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

it("rejects malformed native shell metadata before application callbacks", () => {
  const valid = {
    ...state,
    cwd: "/tmp/public",
    shellReady: true,
    commandRunning: false,
  };
  expect(decodeNativeState(valid)).toMatchObject({
    cwd: "/tmp/public",
    shellReady: true,
    commandRunning: false,
  });
  for (const bad of [
    { cwd: 2 },
    { cwd: "relative" },
    { cwd: "/tmp/bad\0path" },
    { cwd: "/" + "x".repeat(128 * 1024) },
    { shellReady: 1 },
    { commandRunning: "true" },
  ])
    expect(() => decodeNativeState({ ...valid, ...bad })).toThrow("invalid");
});
