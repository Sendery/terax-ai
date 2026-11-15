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

it("accepts a complete applied host receipt and keeps old mode-only payloads compatible", () => {
  const applied = {
    ...state,
    scrollbackRows: 2000,
    hostMutationVersion: 1,
    hostMutationAfterSeq: 7,
  };
  expect(decodeNativeState(applied)).toEqual(applied);
  expect(decodeNativeState({ ...applied, scrollbackRows: null })).toMatchObject(
    { scrollbackRows: null },
  );
  expect(decodeNativeState(state)).toEqual(state);
});
it("rejects partial or malformed applied history receipts", () => {
  const receipt = {
    scrollbackRows: 2000,
    hostMutationVersion: 1,
    hostMutationAfterSeq: 7,
  };
  for (const patch of [
    { scrollbackRows: 199 },
    { scrollbackRows: 50001 },
    { scrollbackRows: 200.5 },
    { hostMutationVersion: -1 },
    { hostMutationVersion: Number.MAX_SAFE_INTEGER + 1 },
    { hostMutationAfterSeq: -1 },
    { hostMutationAfterSeq: 0x100000000 },
    { hostMutationAfterSeq: 1.5 },
  ])
    expect(() => decodeNativeState({ ...state, ...receipt, ...patch })).toThrow(
      "invalid",
    );
  expect(() => decodeNativeState({ ...state, scrollbackRows: 2000 })).toThrow(
    "invalid",
  );
});
