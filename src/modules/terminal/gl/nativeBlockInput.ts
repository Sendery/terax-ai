import type { BlockMode } from "@/modules/terminal/block/lib/modeMachine";
import type { NativeState } from "@/modules/terminal/gl/nativeState";

type Submission = { token: symbol; metadata: number; prompt: number };

export class NativeBlockInput {
  private state: NativeState | null = null;
  private pending: Submission | null = null;
  private value = "";
  private draftRevision = 0;
  private submittedDraft: { token: symbol; revision: number } | null = null;
  private readonly draftListeners = new Set<() => void>();
  private disposed = false;
  private inputFocus: { focus: () => void; focused: () => boolean } | null =
    null;
  private readonly listeners = new Set<() => void>();
  private submitted = false;
  private seenContent = false;
  private inputActive = false;
  get active(): boolean {
    return this.inputActive;
  }
  set active(value: boolean) {
    const watermark = this.watermark;
    if (!this.disposed) this.inputActive = value;
    this.changed(this.mode, this.directInput, watermark);
  }
  get watermark(): "visible" | "hidden" | "dead" {
    if (
      this.disposed ||
      this.submitted ||
      this.seenContent ||
      (this.state?.blocksMetadataVersion ?? 0) > 0
    )
      return "dead";
    return this.mode === "prompt" && !this.inputActive ? "visible" : "hidden";
  }
  markContent(): void {
    const watermark = this.watermark;
    this.seenContent = true;
    this.changed(this.mode, this.directInput, watermark);
  }

  get mode(): BlockMode {
    if (this.disposed) return "running";
    if (this.state?.alternateScreen) return "alt";
    return this.state?.blocksEnabled &&
      this.state.shellReady &&
      !this.state.commandRunning &&
      !this.pending
      ? "prompt"
      : "running";
  }
  get directInput(): boolean {
    return (
      !this.disposed &&
      Boolean(
        this.state?.blocksEnabled &&
          (this.state.commandRunning || this.state.alternateScreen),
      )
    );
  }
  get draft(): string {
    return this.value;
  }
  set draft(text: string) {
    if (this.disposed || this.value === text) return;
    const watermark = this.watermark;
    this.value = text;
    this.inputActive = text.length > 0;
    this.draftRevision++;
    this.changed(this.mode, this.directInput, watermark);
    for (const listener of [...this.draftListeners]) {
      try {
        listener();
      } catch {
        console.error("native block draft observer failed");
      }
    }
  }
  subscribeDraft(listener: () => void): () => void {
    if (this.disposed) return () => {};
    this.draftListeners.add(listener);
    return () => {
      this.draftListeners.delete(listener);
    };
  }
  get hasSubmitted(): boolean {
    return this.submitted;
  }
  get focused(): boolean {
    return this.mode === "prompt" && Boolean(this.inputFocus?.focused());
  }
  subscribe = (listener: () => void): (() => void) => {
    if (this.disposed) return () => {};
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  accept(state: NativeState): void {
    if (this.disposed || (this.state && state.version <= this.state.version))
      return;
    const before = this.mode;
    const direct = this.directInput;
    const watermark = this.watermark;
    this.state = state;
    if (
      this.pending &&
      (state.blocksMetadataVersion > this.pending.metadata ||
        state.promptVersion > this.pending.prompt)
    )
      this.pending = null;
    this.changed(before, direct, watermark);
  }
  beginSubmit(text = this.value): symbol {
    const state = this.state;
    if (this.mode !== "prompt" || !state)
      throw new Error("Terminal command input is not ready.");
    const before = this.mode;
    const token = Symbol();
    this.pending = {
      token,
      metadata: state.blocksMetadataVersion,
      prompt: state.promptVersion,
    };
    this.submittedDraft =
      this.value === text ? { token, revision: this.draftRevision } : null;
    this.submitted = true;
    this.changed(before);
    return token;
  }
  acceptSubmit(token: symbol): void {
    const draft = this.submittedDraft;
    if (draft?.token !== token) return;
    this.submittedDraft = null;
    if (draft.revision === this.draftRevision) this.draft = "";
  }
  rejectSubmit(token: symbol): void {
    if (this.submittedDraft?.token === token) this.submittedDraft = null;
    if (this.pending?.token !== token) return;
    const before = this.mode;
    this.pending = null;
    this.changed(before);
  }
  bindFocus(
    focus: (() => void) | null,
    focused: () => boolean = () => false,
  ): () => void {
    if (this.disposed) return () => {};
    if (!focus) {
      this.inputFocus = null;
      return () => {};
    }
    const binding = { focus, focused };
    this.inputFocus = binding;
    return () => {
      if (this.inputFocus === binding) this.inputFocus = null;
    };
  }
  focus(): boolean {
    if (this.mode !== "prompt" || !this.inputFocus) return false;
    this.inputFocus.focus();
    return true;
  }
  reset(): void {
    const before = this.mode;
    const direct = this.directInput;
    this.state = null;
    this.pending = null;
    this.submittedDraft = null;
    this.changed(before, direct);
  }
  dispose(): void {
    this.reset();
    this.disposed = true;
    this.value = "";
    this.inputFocus = null;
    this.listeners.clear();
    this.draftListeners.clear();
  }
  private changed(
    before: BlockMode,
    direct?: boolean,
    watermark?: string,
  ): void {
    if (
      before === this.mode &&
      (direct === undefined || direct === this.directInput) &&
      (watermark === undefined || watermark === this.watermark)
    )
      return;
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        console.error("native block input observer failed");
      }
    }
  }
}
