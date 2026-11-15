import { validateNativeBlockId } from "@/modules/terminal/gl/nativeBlocks";

export type NativeBlockCommand =
  | { kind: "select"; blockId: string }
  | { kind: "selectAt"; seq: number; row: number }
  | { kind: "navigate"; direction: -1 | 1 }
  | { kind: "find"; blockId: string; query: string }
  | { kind: "reveal"; version: number; index: number }
  | { kind: "clearSearch" };
export type NativeBlockMatch = {
  index: number;
  line: number;
  col: number;
  len: number;
};
export type NativeBlockReply =
  | {
      kind: "selection";
      applied: boolean;
      blockId: string | null;
      selection: string | null;
    }
  | { kind: "matches"; version: number; matches: NativeBlockMatch[] }
  | { kind: "revealed"; found: boolean }
  | { kind: "cleared" };

const encoder = new TextEncoder();
function invalid(): never {
  throw new Error("invalid native terminal block action");
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return invalid();
  return value as Record<string, unknown>;
}
function fields(value: Record<string, unknown>, names: string[]): void {
  const keys = Object.keys(value);
  if (
    keys.length !== names.length ||
    names.some((name) => !keys.includes(name))
  )
    invalid();
}
function integer(value: unknown, min: number, max: number): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  )
    return invalid();
  return value;
}
function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") return invalid();
  return value;
}
export function blockActionSelects(command: NativeBlockCommand): boolean {
  return (
    command.kind === "select" ||
    command.kind === "selectAt" ||
    command.kind === "navigate"
  );
}
export function validateNativeBlockCommand(
  value: unknown,
): asserts value is NativeBlockCommand {
  const data = object(value);
  switch (data.kind) {
    case "select":
      fields(data, ["kind", "blockId"]);
      validateNativeBlockId(data.blockId);
      break;
    case "selectAt":
      fields(data, ["kind", "seq", "row"]);
      integer(data.seq, 1, 0xffffffff);
      integer(data.row, 0, 499);
      break;
    case "navigate":
      fields(data, ["kind", "direction"]);
      if (data.direction !== -1 && data.direction !== 1) invalid();
      break;
    case "find":
      fields(data, ["kind", "blockId", "query"]);
      validateNativeBlockId(data.blockId);
      if (
        typeof data.query !== "string" ||
        data.query.length > 4096 ||
        encoder.encode(data.query).byteLength > 4096 ||
        /[\u0000-\u001f\u007f-\u009f]/.test(data.query)
      )
        invalid();
      break;
    case "reveal":
      fields(data, ["kind", "version", "index"]);
      integer(data.version, 1, Number.MAX_SAFE_INTEGER);
      integer(data.index, 0, 499);
      break;
    case "clearSearch":
      fields(data, ["kind"]);
      break;
    default:
      invalid();
  }
}
export function decodeNativeBlockAction(
  value: unknown,
  command: NativeBlockCommand,
): NativeBlockReply {
  const data = object(value);
  if (blockActionSelects(command)) {
    fields(data, ["kind", "applied", "blockId", "selection"]);
    if (data.kind !== "selection") return invalid();
    const applied = boolean(data.applied);
    if (applied) validateNativeBlockId(data.blockId);
    else if (data.blockId !== null) return invalid();
    if (
      data.selection !== null &&
      (typeof data.selection !== "string" ||
        data.selection.length > 16 * 1024 * 1024 ||
        encoder.encode(data.selection).byteLength > 16 * 1024 * 1024)
    )
      return invalid();
    return {
      kind: "selection",
      applied,
      blockId: data.blockId as string | null,
      selection: data.selection as string | null,
    };
  }
  switch (command.kind) {
    case "find": {
      fields(data, ["kind", "version", "matches"]);
      if (
        data.kind !== "matches" ||
        !Array.isArray(data.matches) ||
        data.matches.length > 500
      )
        return invalid();
      const version = integer(data.version, 1, Number.MAX_SAFE_INTEGER);
      const matches = data.matches.map((value, at) => {
        const match = object(value);
        fields(match, ["index", "line", "col", "len"]);
        const index = integer(match.index, at, at);
        const col = integer(match.col, 0, 999);
        return {
          index,
          line: integer(match.line, 0, 0xffffffff),
          col,
          len: integer(match.len, 1, 1000 - col),
        };
      });
      return { kind: "matches", version, matches };
    }
    case "reveal":
      fields(data, ["kind", "found"]);
      if (data.kind !== "revealed") return invalid();
      return { kind: "revealed", found: boolean(data.found) };
    case "clearSearch":
      fields(data, ["kind"]);
      if (data.kind !== "cleared") return invalid();
      return { kind: "cleared" };
    default:
      return invalid();
  }
}
