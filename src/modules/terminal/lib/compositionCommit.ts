export type CommitKeyEvent = Pick<
  KeyboardEvent,
  | "type"
  | "key"
  | "keyCode"
  | "isComposing"
  | "shiftKey"
  | "ctrlKey"
  | "metaKey"
>;
export type CommitInputEvent = Pick<InputEvent, "inputType" | "data">;

export type CommitKeyDecision =
  | { kind: "pass" }
  | { kind: "swallow" }
  | { kind: "send"; data: string };

export type CompositionCommitFilter = {
  compositionEnded(): void;
  onKey(event: CommitKeyEvent): CommitKeyDecision;
  takeInput(event: CommitInputEvent): string | null;
};

const NAMED_KEY = /^[A-Z][A-Za-z0-9]+$/;
const PASS: CommitKeyDecision = { kind: "pass" };
const SWALLOW: CommitKeyDecision = { kind: "swallow" };

function controlSequence(key: string, shift: boolean): string | null {
  const last = key.charCodeAt(key.length - 1);
  if (last >= 0x20 && last !== 0x7f) return null;
  if (last === 0x09 && shift) return "\x1b[Z";
  return key.slice(-1);
}

/** WebKit ends a dead-key composition ("~" then "/") before dispatching the
 * keydown that ended it, then reports that keystroke as key "~/" with a
 * keypress for "~". xterm has already flushed the "~", so it sends "~~" and
 * ignores the input event carrying the "/". This swallows that one keystroke
 * and hands back what its input event inserted. A control key arrives as
 * "~\r" or "~\t" with a bogus keyCode, so its own character is sent instead.
 * Chromium dispatches the keydown before compositionend, and its keyup clears
 * the pending commit. */
export function createCompositionCommitFilter(): CompositionCommitFilter {
  let commitPending = false;
  let swallowing = false;
  return {
    compositionEnded() {
      commitPending = true;
    },
    onKey(event) {
      if (event.type === "keyup") {
        commitPending = false;
        swallowing = false;
        return PASS;
      }
      if (event.type === "keypress") return swallowing ? SWALLOW : PASS;
      if (event.type !== "keydown") return PASS;
      const pending = commitPending;
      commitPending = false;
      swallowing = false;
      if (
        !pending ||
        event.isComposing ||
        event.keyCode === 229 ||
        event.ctrlKey ||
        event.metaKey ||
        NAMED_KEY.test(event.key)
      ) {
        return PASS;
      }
      const control = controlSequence(event.key, event.shiftKey);
      if (control !== null) return { kind: "send", data: control };
      swallowing = true;
      return SWALLOW;
    },
    takeInput(event) {
      if (!swallowing || event.inputType !== "insertText" || !event.data)
        return null;
      swallowing = false;
      return event.data;
    },
  };
}
