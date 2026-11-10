import {
  type DecodedFrame,
  decodeFrame,
  peekSeq,
} from "@/modules/terminal/gl/frameCodec";
import type {
  GridRenderer,
  RenderPane,
} from "@/modules/terminal/gl/gridRenderer";
import {
  encodeKey,
  encodePaste,
  wheelRows,
} from "@/modules/terminal/gl/keyInput";
import { currentWorkspaceEnv } from "@/modules/workspace";
import { Channel, invoke } from "@tauri-apps/api/core";

export type BenchKind = "ascii" | "sgr" | "tui";

export type BenchStats = {
  bytesFed: number;
  frames: number;
  frameBytes: number;
  encodeMicros: number;
  creditWaitMicros: number;
};

export type FrameEvent = {
  seq: number;
  bytes: number;
  receivedAt: number;
  /** Valid only during the callback; null when the frame did not decode. */
  frame: DecodedFrame | null;
};

export type SessionObserver = {
  onFrame?: (event: FrameEvent) => void;
  onDrawn?: (at: number) => void;
  onCredit?: (seq: number, at: number) => void;
  onExit?: (code: number) => void;
  onError?: (error: unknown) => void;
};

export function engineAvailable(): Promise<boolean> {
  return invoke<boolean>("gterm_available").then(
    (value) => value === true,
    () => false,
  );
}

export function openTerminalLabWindow(): Promise<void> {
  return invoke("open_terminal_lab_window");
}

/** The result file of an unattended lab run, or null for an interactive one. */
export function labAutorunPath(): Promise<string | null> {
  return invoke<string | null>("gterm_lab_autorun").catch(() => null);
}

/** Writes the run's report and exits the app (autorun only). */
export function submitLabReport(json: string): Promise<void> {
  return invoke("gterm_lab_report", { json });
}

const textEncoder = new TextEncoder();
const noop = () => {};

/**
 * One terminal on the Rust engine drawn into one pane of a shared renderer.
 * The only place that talks to the engine commands. Credits follow the
 * contract: a frame is applied, the next animation frame draws it, and only
 * then is its credit returned.
 */
export class EngineSession {
  readonly pane: RenderPane;
  id: number | null = null;
  exitCode: number | null = null;
  private readonly renderer: GridRenderer;
  private readonly observer: SessionObserver;
  private readonly frames = new Channel<ArrayBuffer>();
  private readonly exits = new Channel<number>();
  private readonly isBench: boolean;
  private awaitingDraw: number[] = [];
  private drawnUnsent: number[] = [];
  private fullRequested = false;
  private closed = false;
  private size: { cols: number; rows: number };

  private constructor(
    renderer: GridRenderer,
    observer: SessionObserver,
    size: { cols: number; rows: number },
    isBench: boolean,
  ) {
    this.renderer = renderer;
    this.observer = observer;
    this.size = size;
    this.isBench = isBench;
    this.pane = renderer.addPane({
      onNeedFullFrame: () => this.requestFull(),
      onDrawn: () => this.handleDrawn(),
    });
    this.frames.onmessage = (buffer) => this.receive(buffer);
    this.exits.onmessage = (code) => {
      this.exitCode = code;
      this.observer.onExit?.(code);
    };
  }

  static async open(
    renderer: GridRenderer,
    options: {
      cols: number;
      rows: number;
      cwd?: string;
      observer?: SessionObserver;
    },
  ): Promise<EngineSession> {
    const session = new EngineSession(
      renderer,
      options.observer ?? {},
      { cols: options.cols, rows: options.rows },
      false,
    );
    return session.start("gterm_open", {
      cols: options.cols,
      rows: options.rows,
      cwd: options.cwd ?? null,
      workspace: currentWorkspaceEnv(),
    });
  }

  static async openBench(
    renderer: GridRenderer,
    options: {
      kind: BenchKind;
      megabytes: number;
      cols: number;
      rows: number;
      observer?: SessionObserver;
    },
  ): Promise<EngineSession> {
    const session = new EngineSession(
      renderer,
      options.observer ?? {},
      { cols: options.cols, rows: options.rows },
      true,
    );
    return session.start("gterm_bench_open", {
      kind: options.kind,
      megabytes: options.megabytes,
      cols: options.cols,
      rows: options.rows,
    });
  }

  private async start(
    command: string,
    args: Record<string, unknown>,
  ): Promise<EngineSession> {
    try {
      this.id = await invoke<number>(command, {
        ...args,
        onFrame: this.frames,
        onExit: this.exits,
      });
    } catch (error) {
      this.release();
      throw error;
    }
    if (this.closed) {
      void this.closeById(this.id).catch(() => {});
      throw new Error("session closed while opening");
    }
    this.flushCredits();
    return this;
  }

  get cursor(): { x: number; y: number } | null {
    const header = this.pane.header;
    return header ? { x: header.cursorX, y: header.cursorY } : null;
  }

  get grid(): { cols: number; rows: number } {
    return this.size;
  }

  private receive(buffer: ArrayBuffer): void {
    if (this.closed) return;
    const receivedAt = performance.now();
    let frame: DecodedFrame | null = null;
    let seq: number;
    try {
      frame = decodeFrame(buffer);
      seq = frame.seq;
    } catch (error) {
      seq = peekSeq(buffer);
      this.observer.onError?.(error);
    }
    let applied = false;
    if (frame) {
      if (frame.full) this.fullRequested = false;
      applied = this.renderer.applyFrame(this.pane, frame) === "applied";
    }
    this.awaitingDraw.push(seq);
    if (!applied) {
      // The frame still holds the session's only credit: it goes back after
      // the next display frame like any other, and a full frame follows.
      this.requestFull();
      this.renderer.markUndrawn(this.pane);
    }
    this.observer.onFrame?.({
      seq,
      bytes: buffer.byteLength,
      receivedAt,
      frame,
    });
  }

  private handleDrawn(): void {
    const at = performance.now();
    if (this.awaitingDraw.length > 0) {
      for (const seq of this.awaitingDraw) this.drawnUnsent.push(seq);
      this.awaitingDraw = [];
    }
    this.observer.onDrawn?.(at);
    this.flushCredits();
  }

  private flushCredits(): void {
    const id = this.id;
    if (id === null || this.closed || this.drawnUnsent.length === 0) return;
    const seqs = this.drawnUnsent;
    this.drawnUnsent = [];
    for (const seq of seqs) {
      this.observer.onCredit?.(seq, performance.now());
      invoke("gterm_credit", { id, seq }).catch(this.reportError);
    }
  }

  private readonly reportError = (error: unknown): void => {
    if (!this.closed) this.observer.onError?.(error);
  };

  requestFull(): void {
    const id = this.id;
    if (id === null || this.closed || this.fullRequested) return;
    this.fullRequested = true;
    invoke("gterm_request_full", { id }).catch(this.reportError);
  }

  write(text: string): Promise<void> {
    const id = this.id;
    if (id === null || this.closed || text.length === 0) {
      return Promise.resolve();
    }
    return invoke("pty_write", textEncoder.encode(text), {
      headers: { "x-pty-id": String(id) },
    });
  }

  resize(cols: number, rows: number): void {
    if (cols === this.size.cols && rows === this.size.rows) return;
    this.size = { cols, rows };
    const id = this.id;
    if (id === null || this.closed) return;
    invoke("pty_resize", { id, cols, rows }).catch(this.reportError);
  }

  scroll(delta: number): void {
    const id = this.id;
    if (id === null || this.closed || delta === 0) return;
    invoke("gterm_scroll", { id, delta }).catch(this.reportError);
  }

  benchStats(): Promise<BenchStats> {
    if (this.id === null) return Promise.reject(new Error("not open"));
    return invoke<BenchStats>("gterm_bench_stats", { id: this.id });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    const id = this.id;
    this.release();
    if (id !== null) await this.closeById(id);
  }

  private async closeById(id: number): Promise<void> {
    try {
      await invoke("pty_close", { id });
    } catch (error) {
      // A bench session has no PTY; the engine may already have dropped it.
      if (!this.isBench) throw error;
    }
  }

  private release(): void {
    this.closed = true;
    this.frames.onmessage = noop;
    this.exits.onmessage = noop;
    this.awaitingDraw = [];
    this.drawnUnsent = [];
    this.renderer.removePane(this.pane);
  }
}

export type InputBinding = { dispose: () => void; focus: () => void };

/**
 * Keyboard, paste and wheel for one engine pane. Printable text and IME
 * composition arrive through a hidden textarea; everything else is encoded
 * from keydown by `encodeKey`.
 */
export function attachInput(
  session: EngineSession,
  renderer: GridRenderer,
  host: HTMLElement,
): InputBinding {
  const textarea = document.createElement("textarea");
  textarea.setAttribute("aria-label", "Terminal input");
  textarea.setAttribute("autocapitalize", "off");
  textarea.setAttribute("autocomplete", "off");
  textarea.setAttribute("autocorrect", "off");
  textarea.spellcheck = false;
  textarea.style.cssText =
    "position:absolute;left:0;top:0;width:2px;height:1em;opacity:0;padding:0;border:0;margin:0;resize:none;overflow:hidden;white-space:nowrap;pointer-events:none;caret-color:transparent;";
  host.appendChild(textarea);
  let wheelCarry = 0;

  const send = (text: string) => {
    session.write(text).catch(() => {});
  };
  const flushTextarea = () => {
    const value = textarea.value;
    textarea.value = "";
    if (value) send(value);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const bytes = encodeKey({
      key: event.key,
      code: event.code,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
      isComposing: event.isComposing || event.keyCode === 229,
    });
    if (bytes === null) return;
    event.preventDefault();
    send(bytes);
  };
  const onInput = (event: Event) => {
    if ((event as InputEvent).isComposing) return;
    flushTextarea();
  };
  const onCompositionStart = () => {
    const cursor = session.cursor;
    if (!cursor) return;
    const cell = renderer.cellSize;
    textarea.style.left = `${session.pane.rect.x + cursor.x * cell.width}px`;
    textarea.style.top = `${session.pane.rect.y + cursor.y * cell.height}px`;
  };
  const onPaste = (event: ClipboardEvent) => {
    event.preventDefault();
    const text = event.clipboardData?.getData("text/plain") ?? "";
    if (text) send(encodePaste(text));
  };
  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    const next = wheelRows(
      wheelCarry,
      event.deltaY,
      event.deltaMode,
      renderer.cellSize.height,
      session.grid.rows,
    );
    wheelCarry = next.carry;
    session.scroll(next.rows);
  };
  const onPointerDown = (event: PointerEvent) => {
    event.preventDefault();
    textarea.focus();
  };
  const onFocus = () => renderer.setPaneFocused(session.pane, true);
  const onBlur = () => renderer.setPaneFocused(session.pane, false);

  textarea.addEventListener("keydown", onKeyDown);
  textarea.addEventListener("input", onInput);
  textarea.addEventListener("compositionstart", onCompositionStart);
  textarea.addEventListener("compositionend", flushTextarea);
  textarea.addEventListener("paste", onPaste);
  textarea.addEventListener("focus", onFocus);
  textarea.addEventListener("blur", onBlur);
  host.addEventListener("wheel", onWheel, { passive: false });
  host.addEventListener("pointerdown", onPointerDown);
  renderer.setPaneFocused(session.pane, document.activeElement === textarea);

  return {
    focus: () => textarea.focus(),
    dispose: () => {
      textarea.removeEventListener("keydown", onKeyDown);
      textarea.removeEventListener("input", onInput);
      textarea.removeEventListener("compositionstart", onCompositionStart);
      textarea.removeEventListener("compositionend", flushTextarea);
      textarea.removeEventListener("paste", onPaste);
      textarea.removeEventListener("focus", onFocus);
      textarea.removeEventListener("blur", onBlur);
      host.removeEventListener("wheel", onWheel);
      host.removeEventListener("pointerdown", onPointerDown);
      textarea.remove();
    },
  };
}
