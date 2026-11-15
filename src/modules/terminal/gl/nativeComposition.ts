import {
  createCompositionCommitFilter,
  type CommitInputEvent,
  type CommitKeyEvent,
  type CommitKeyDecision,
} from "@/modules/terminal/lib/compositionCommit";

type CompositionInput = CommitInputEvent & { isComposing: boolean };

/** Tracks event order; the DOM binding ends the current turn with a zero-delay task. */
export function createNativeComposition() {
  const filter = createCompositionCommitFilter();
  let active = false;
  let nextStartsDeadKey = false;
  let deadKey = false;
  let endedThisTurn = false;
  let confirmingEnterHeld = false;
  let committed: string | null = null;
  return {
    get active() {
      return active;
    },
    start() {
      active = true;
      deadKey = nextStartsDeadKey;
      nextStartsDeadKey = false;
      endedThisTurn = false;
      confirmingEnterHeld = false;
      committed = null;
    },
    end(text: string): string {
      active = false;
      committed = text || null;
      endedThisTurn = Boolean(text) && !deadKey;
      if (text) filter.compositionEnded();
      return text;
    },
    finishTurn() {
      endedThisTurn = false;
    },
    onKey(event: CommitKeyEvent): CommitKeyDecision {
      if (event.type === "keydown") {
        nextStartsDeadKey = event.key === "Dead";
        if (event.key === "Enter") {
          if (active || event.isComposing || event.keyCode === 229)
            confirmingEnterHeld = true;
          else if (confirmingEnterHeld || endedThisTurn) {
            confirmingEnterHeld = true;
            return { kind: "swallow" };
          }
        }
      }
      if (event.type === "keyup") {
        if (event.key === "Enter") confirmingEnterHeld = false;
        committed = null;
      }
      const decision = filter.onKey(event);
      if (event.type === "keydown" && decision.kind === "pass" && !active) {
        committed = null;
        endedThisTurn = false;
      }
      return decision;
    },
    takeInput(event: CompositionInput, value: string): string | null {
      if (active || event.isComposing) return null;
      const corrected = filter.takeInput(event);
      if (corrected !== null) {
        committed = null;
        return corrected;
      }
      const text = value || event.data || "";
      if (
        committed !== null &&
        (text === committed || event.data === committed)
      ) {
        committed = null;
        return null;
      }
      committed = null;
      return text || null;
    },
  };
}
