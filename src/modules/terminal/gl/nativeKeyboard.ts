import type { NativeKeyEvent } from "@/modules/terminal/gl/engineSession";

export type NativeKeyboardEvent = Pick<
  KeyboardEvent,
  | "type"
  | "code"
  | "key"
  | "shiftKey"
  | "ctrlKey"
  | "altKey"
  | "metaKey"
  | "isComposing"
  | "keyCode"
  | "repeat"
  | "getModifierState"
>;

/** Ownership only: protocol encoding stays on the native terminal actor. */
export function nativeKeyEvent(
  event: NativeKeyboardEvent,
  isMac: boolean,
): NativeKeyEvent | null {
  if (
    event.isComposing ||
    event.keyCode === 229 ||
    event.key === "Dead" ||
    event.key === "Process" ||
    event.key === "Unidentified"
  )
    return null;
  if (isMac && event.metaKey) return null;
  if (!isMac && event.ctrlKey && event.shiftKey && /^[cv]$/i.test(event.key))
    return null;
  const printable = Array.from(event.key).length === 1;
  const mods =
    (event.shiftKey ? 1 : 0) |
    (event.altKey ? 2 : 0) |
    (event.ctrlKey ? 4 : 0) |
    (event.metaKey ? 8 : 0) |
    (event.getModifierState("CapsLock") ? 16 : 0) |
    (event.getModifierState("NumLock") ? 32 : 0);
  let consumedMods = printable && event.shiftKey ? 1 : 0;
  if (printable && event.getModifierState("AltGraph")) consumedMods |= mods & 6;
  if (printable && isMac && event.altKey && !event.ctrlKey) consumedMods |= 2;
  const lower = printable ? event.key.toLowerCase() : "";
  const unshifted =
    Array.from(lower).length === 1 &&
    (!event.shiftKey || /^\p{L}$/u.test(event.key))
      ? lower
      : undefined;
  return {
    code: event.code || "Unidentified",
    text: printable && event.type !== "keyup" ? event.key : undefined,
    action:
      event.type === "keyup" ? "release" : event.repeat ? "repeat" : "press",
    mods,
    consumedMods,
    unshifted,
  };
}
