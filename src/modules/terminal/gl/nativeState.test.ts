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
  blocksEnabled: false,
  blocksMetadataVersion: 0,
  promptVersion: 0,
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

it("validates the native block mode, metadata revision and repeated prompt revision", () => {
  const blocks = {
    ...state,
    blocksEnabled: true,
    blocksMetadataVersion: 2,
    promptVersion: 3,
  };
  expect(decodeNativeState(blocks)).toMatchObject({
    blocksEnabled: true,
    blocksMetadataVersion: 2,
    promptVersion: 3,
  });
  for (const bad of [
    { blocksEnabled: "true" },
    { blocksMetadataVersion: -1 },
    { blocksMetadataVersion: Number.MAX_SAFE_INTEGER + 1 },
    { promptVersion: -1 },
    { promptVersion: 1.5 },
  ])
    expect(() => decodeNativeState({ ...blocks, ...bad })).toThrow("invalid");
});
