import type { NativeBlockInput } from "@/modules/terminal/gl/nativeBlockInput";
import {
  focusedNativeLeaf,
  getNativeLeaf,
  nativeLeafForPty,
  subscribeNativeLeaf,
  takeNativeLeaf,
} from "@/modules/terminal/gl/nativeLeafRegistry";
import {
  createTerminalSubmission,
  type TerminalSubmission,
} from "@/modules/terminal/lib/sessionSubmission";
import type { TerminalInput } from "@/modules/terminal/lib/terminalInput";
import { invoke } from "@tauri-apps/api/core";
import type { BlockMode } from "../block/lib/modeMachine";
import { ensureAgentActivityListener } from "./agentActivity";

// Leaf-level facade over the native terminal registry. Everything outside the
// terminal module addresses a terminal by leaf id through these functions, so
// callers never hold a NativeLeaf across a respawn or a close.

// Every window that hosts a terminal loads this module, which makes it the one
// place that starts the agent-signal listener behind tab badges, notifications
// and the agent-aware copy. Nothing here needs the exit callback.
ensureAgentActivityListener(() => {});

const readyLeaves = new Set<number>();
const readyWaiters = new Map<
  number,
  { resolve: () => void; timer: ReturnType<typeof setTimeout> }[]
>();

export function markSessionReady(leafId: number): void {
  if (readyLeaves.has(leafId)) return;
  readyLeaves.add(leafId);
  const waiters = readyWaiters.get(leafId);
  if (!waiters) return;
  readyWaiters.delete(leafId);
  for (const w of waiters) {
    clearTimeout(w.timer);
    w.resolve();
  }
}

export function resetSessionReady(leafId: number): void {
  readyLeaves.delete(leafId);
}

export function whenSessionReady(
  leafId: number,
  timeoutMs = 4000,
): Promise<void> {
  if (readyLeaves.has(leafId)) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      const arr = readyWaiters.get(leafId);
      const i = arr?.findIndex((w) => w.timer === timer) ?? -1;
      if (arr && i >= 0) arr.splice(i, 1);
      resolve();
    }, timeoutMs);
    const arr = readyWaiters.get(leafId) ?? [];
    arr.push({ resolve, timer });
    readyWaiters.set(leafId, arr);
  });
}

export function captureLeafInput(leafId: number): TerminalInput | null {
  const native = getNativeLeaf(leafId);
  if (!native) return null;
  if (!native.writeOwned || !native.encodeShiftEnter || !native.readText)
    return null;
  const identity = native.submissionIdentity ?? native;
  const id = native.id;
  const current = () =>
    getNativeLeaf(leafId) === native &&
    (native.submissionIdentity ?? native) === identity &&
    (id === null || native.id === id) &&
    !native.exited;
  return {
    current,
    cwd: () => (current() ? native.cwd : null),
    isReady: () => current() && native.tuiReady,
    write: async (text, caller = () => true) => {
      const valid = () => current() && caller();
      if (!valid()) throw new Error("Terminal is no longer available.");
      await native.writeOwned?.(text, valid);
      if (!valid()) throw new Error("Terminal is no longer available.");
    },
    shiftEnter: async () => {
      if (!current()) throw new Error("Terminal is no longer available.");
      const value = await native.encodeShiftEnter?.();
      if (!current() || value === undefined)
        throw new Error("Terminal is no longer available.");
      return value;
    },
    readBuffer: async (maxLines, caller = () => true) => {
      if (!current() || !caller()) return null;
      const value = await native.readText?.(maxLines);
      return current() && caller() ? (value ?? null) : null;
    },
  };
}

export function captureLeafSubmission(
  leafId: number,
): TerminalSubmission | null {
  const native = getNativeLeaf(leafId);
  if (!native) return null;
  const identity = native.submissionIdentity ?? native;
  const id = native.id;
  return createTerminalSubmission({
    current: () =>
      getNativeLeaf(leafId) === native &&
      (native.submissionIdentity ?? native) === identity &&
      (id === null || native.id === id) &&
      !native.exited,
    ready: () =>
      native.id !== null &&
      native.shellReady &&
      !native.commandRunning &&
      !native.alternateScreen,
    wait: (timeout) => whenSessionReady(leafId, timeout),
    submit: (text, current, onWriteAttempt) =>
      native.submit(text, current, onWriteAttempt),
  });
}

export function writeToSession(leafId: number, data: string): boolean {
  return getNativeLeaf(leafId)?.write(data) ?? false;
}

export function submitToLeaf(leafId: number, text: string): void {
  const native = getNativeLeaf(leafId);
  if (!native || native.exited) return;
  void native
    .submit(text)
    .catch((error) => console.error("native terminal submit failed", error));
}

export function interruptLeaf(leafId: number): void {
  getNativeLeaf(leafId)?.write("\x03");
}

/**
 * True once a full-screen TUI in this leaf has taken the terminal into raw
 * mode, which it announces by negotiating modifyOtherKeys (pi-tui does this as
 * soon as its input loop is live, and turns it back off when it exits).
 *
 * Callers that synthesize input use this instead of a timer: a shell still
 * loading an agent swallows keystrokes, and the Enter that would submit them
 * disappears with the rest of the burst.
 */
export function isLeafTuiReady(leafId: number): boolean {
  return getNativeLeaf(leafId)?.tuiReady ?? false;
}

export function leafCwd(leafId: number): string | null {
  return getNativeLeaf(leafId)?.cwd ?? null;
}

export function navigateFocusedBlocks(dir: -1 | 1): boolean {
  const native = focusedNativeLeaf();
  if (!native?.blockInput || !native.navigateBlocks) return false;
  void native.navigateBlocks(dir).catch(() => {});
  return true;
}

export function clearLeafBlockSelection(leafId: number): boolean {
  const native = getNativeLeaf(leafId);
  if (!native?.blockInput) return false;
  return native.clearBlockSelection?.() ?? false;
}

export function leafGridSelection(leafId: number): string | null {
  return getNativeLeaf(leafId)?.getSelection() ?? null;
}

export function getLeafBlockMode(leafId: number): BlockMode {
  return getNativeLeaf(leafId)?.blockInput?.mode ?? "prompt";
}

// A leaf registers after the views that observe it mount, and re-registers on
// a respawn, so every subscription rebinds whenever the registry changes.
function followBlockInput(
  leafId: number,
  attach: (input: NativeBlockInput) => () => void,
  onRebind?: () => void,
): () => void {
  let detach: () => void = () => {};
  const bind = () => {
    detach();
    const input = getNativeLeaf(leafId)?.blockInput;
    detach = input ? attach(input) : () => {};
  };
  bind();
  const unwatch = subscribeNativeLeaf(leafId, () => {
    bind();
    onRebind?.();
  });
  return () => {
    unwatch();
    detach();
  };
}

export function subscribeLeafBlockMode(
  leafId: number,
  cb: () => void,
): () => void {
  return followBlockInput(leafId, (input) => input.subscribe(cb), cb);
}

export function setLeafInputFocus(
  leafId: number,
  fn: (() => void) | null,
  focused: () => boolean = () => false,
): () => void {
  return followBlockInput(leafId, (input) => input.bindFocus(fn, focused));
}

export function focusLeafInput(leafId: number): void {
  getNativeLeaf(leafId)?.focus();
}

export function getLeafDraft(leafId: number): string {
  return getNativeLeaf(leafId)?.blockInput?.draft ?? "";
}

export function subscribeLeafDraft(leafId: number, cb: () => void): () => void {
  return followBlockInput(leafId, (input) => input.subscribeDraft(cb), cb);
}

export function setLeafDraft(leafId: number, text: string): void {
  const input = getNativeLeaf(leafId)?.blockInput;
  if (input) input.draft = text;
}

export function setLeafInputActivity(leafId: number, active: boolean): void {
  const input = getNativeLeaf(leafId)?.blockInput;
  if (input) input.active = active;
}

export type WatermarkState = "visible" | "hidden" | "dead";

// Watermark gate: a block terminal that has never run a command, whose grid is
// still untouched, and whose input is empty. "dead" is permanent and lets the
// component unmount for good.
export function blockWatermarkState(leafId: number): WatermarkState {
  return getNativeLeaf(leafId)?.blockInput?.watermark ?? "dead";
}

function ownsFocusedGrid(leafId: number, target: Element | null): boolean {
  if (
    !target ||
    target !== document.activeElement ||
    typeof target.closest !== "function"
  )
    return false;
  return (
    target.localName === "textarea" &&
    !(target as HTMLTextAreaElement).disabled &&
    Boolean(target.closest("[data-native-terminal-grid]")) &&
    target
      .closest("[data-native-terminal-leaf]")
      ?.getAttribute("data-native-terminal-leaf") === String(leafId)
  );
}

/** Whether the manual clear-active shortcut may send Ctrl+L to this leaf. */
export function canClearActiveLeaf(
  leafId: number,
  target: Element | null,
): boolean {
  const native = getNativeLeaf(leafId);
  return Boolean(
    native &&
      native.id !== null &&
      !native.exited &&
      native.focused &&
      (native.blockInput?.directInput ?? true) &&
      ownsFocusedGrid(leafId, target),
  );
}

/** Sends the existing formfeed; this is distinct from host scrollback clearing. */
export async function clearActiveLeaf(
  leafId: number,
  current: () => boolean = () => true,
): Promise<boolean> {
  const target = document.activeElement;
  const valid = () => current() && canClearActiveLeaf(leafId, target);
  if (!valid()) return false;
  const input = captureLeafInput(leafId);
  if (!input) return false;
  const owned = () => input.current() && valid();
  try {
    await input.write("\x0c", owned);
  } catch (error) {
    if (!owned()) return false;
    throw error;
  }
  return owned();
}

/** Whether host clear belongs to this real terminal focus, including a retained core. */
export function canClearFocusedTerminal(
  leafId: number,
  target: Element | null,
): boolean {
  const native = getNativeLeaf(leafId);
  return Boolean(
    native?.clear &&
      native.id !== null &&
      native.focused &&
      ownsFocusedGrid(leafId, target),
  );
}

/** Host scrollback clear; never sends Ctrl+L or resets a shell. Private manual gestures are allowed. */
export async function clearFocusedTerminal(
  requestedLeafId?: number,
  current: () => boolean = () => true,
): Promise<boolean> {
  const target = document.activeElement;
  const nativeId = target
    ?.closest?.("[data-native-terminal-leaf]")
    ?.getAttribute("data-native-terminal-leaf");
  const candidate =
    nativeId === undefined || nativeId === null ? null : Number(nativeId);
  const leafId =
    requestedLeafId ??
    (candidate !== null &&
    Number.isSafeInteger(candidate) &&
    canClearFocusedTerminal(candidate, target)
      ? candidate
      : undefined);
  if (leafId === undefined) return false;
  const native = getNativeLeaf(leafId);
  if (!native?.clear) return false;
  const identity = native.submissionIdentity;
  const valid = () =>
    current() &&
    canClearFocusedTerminal(leafId, target) &&
    getNativeLeaf(leafId) === native &&
    native.submissionIdentity === identity;
  if (!valid()) return false;
  try {
    return (await native.clear(valid)) && valid();
  } catch (error) {
    if (!valid()) return false;
    throw error;
  }
}

export function leafIdForPty(ptyId: number): number | null {
  return nativeLeafForPty(ptyId);
}

export function ptyIdForLeaf(leafId: number): number | null {
  return getNativeLeaf(leafId)?.id ?? null;
}

export async function respawnSession(
  leafId: number,
  cwd?: string,
): Promise<void> {
  await getNativeLeaf(leafId)?.respawn(cwd);
}

export async function leafHasForegroundProcess(
  leafId: number,
): Promise<boolean> {
  const native = getNativeLeaf(leafId);
  if (!native || native.id === null || native.exited) return false;
  return invoke<boolean>("pty_has_foreground_process", {
    id: native.id,
  }).catch(() => false);
}

export function disposeSession(leafId: number): void {
  const native = takeNativeLeaf(leafId);
  if (native)
    void native
      .dispose()
      .catch((error) => console.error("native terminal close failed", error));
  readyLeaves.delete(leafId);
  const waiters = readyWaiters.get(leafId);
  if (!waiters) return;
  readyWaiters.delete(leafId);
  for (const w of waiters) {
    clearTimeout(w.timer);
    w.resolve();
  }
}

/**
 * Force a repaint of one leaf, or of the focused one when no leaf is given.
 * GPU state can go bad in ways nothing here observes (a driver reset, an
 * external display waking), so the user gets a way to ask for it directly
 * rather than having to select the damaged text to repair it.
 */
export function repaintLeaf(leafId: number | null): void {
  const native = leafId === null ? focusedNativeLeaf() : getNativeLeaf(leafId);
  native?.repaint();
}

// Goes through the engine's paste path, so an app that enabled bracketed paste
// (Claude Code) treats a dropped path as a real paste while a plain shell gets
// the literal text.
export function pasteIntoLeaf(leafId: number, text: string): boolean {
  const native = getNativeLeaf(leafId);
  if (!native || native.exited) return false;
  void native
    .paste(text)
    .catch((error) => console.error("native terminal paste failed", error));
  return true;
}
