import { expect, it } from "vitest";
import {
  decodeNativeBlockAction,
  validateNativeBlockCommand,
} from "@/modules/terminal/gl/nativeBlockActions";

it("accepts only the closed bounded native block commands", () => {
  for (const value of [
    { kind: "select", blockId: "b1" },
    { kind: "selectAt", seq: 1, row: 0 },
    { kind: "navigate", direction: -1 },
    { kind: "find", blockId: "b1", query: "e\u0301界" },
    { kind: "reveal", version: 1, index: 499 },
    { kind: "clearSearch" },
  ])
    expect(() => validateNativeBlockCommand(value)).not.toThrow();
  for (const value of [
    null,
    {},
    { kind: "other" },
    { kind: "select", blockId: "b0" },
    { kind: "select", blockId: "b1", script: "x" },
    { kind: "selectAt", seq: 0, row: 0 },
    { kind: "selectAt", seq: 1, row: 500 },
    { kind: "navigate", direction: 0 },
    { kind: "find", blockId: "b1", query: 42 },
    { kind: "find", blockId: "b1", query: "x".repeat(4097) },
    { kind: "find", blockId: "b1", query: "bad\nquery" },
    { kind: "reveal", version: 0, index: 0 },
    { kind: "reveal", version: 1, index: 500 },
    { kind: "reveal", version: Number.MAX_SAFE_INTEGER + 1, index: 0 },
    { kind: "clearSearch", blockId: "b1" },
  ])
    expect(() => validateNativeBlockCommand(value)).toThrow("invalid");
});
it("decodes selection receipts only for their matching action and bounded text", () => {
  const command = { kind: "select", blockId: "b1" } as const;
  const reply = {
    kind: "selection",
    applied: true,
    blockId: "b1",
    selection: "one",
  };
  expect(decodeNativeBlockAction(reply, command)).toEqual(reply);
  expect(
    decodeNativeBlockAction(
      { ...reply, applied: false, blockId: null },
      command,
    ),
  ).toMatchObject({ applied: false });
  for (const patch of [
    { kind: "cleared" },
    { applied: "yes" },
    { blockId: "b0" },
    { selection: 42 },
    { selection: "x".repeat(16 * 1024 * 1024 + 1) },
    { applied: false },
    { unexpected: true },
  ])
    expect(() =>
      decodeNativeBlockAction({ ...reply, ...patch }, command),
    ).toThrow("invalid");
});
it("decodes versioned native matches and rejects forged indices or coordinates", () => {
  const command = { kind: "find", blockId: "b1", query: "one" } as const;
  const match = { index: 0, line: 20, col: 2, len: 3 };
  const reply = { kind: "matches", version: 1, matches: [match] };
  expect(decodeNativeBlockAction(reply, command)).toEqual(reply);
  for (const patch of [
    { version: 0 },
    { version: NaN },
    { matches: Array(501).fill(match) },
    ...[
      { index: 1 },
      { line: -1 },
      { col: 1000 },
      { len: 0 },
      { col: 999, len: 2 },
      { unexpected: true },
    ].map((p) => ({ matches: [{ ...match, ...p }] })),
  ])
    expect(() =>
      decodeNativeBlockAction({ ...reply, ...patch }, command),
    ).toThrow("invalid");
  expect(() => decodeNativeBlockAction(reply, { kind: "clearSearch" })).toThrow(
    "invalid",
  );
  expect(
    decodeNativeBlockAction(
      { kind: "revealed", found: false },
      { kind: "reveal", version: 1, index: 0 },
    ),
  ).toEqual({ kind: "revealed", found: false });
  expect(
    decodeNativeBlockAction({ kind: "cleared" }, { kind: "clearSearch" }),
  ).toEqual({ kind: "cleared" });
});
