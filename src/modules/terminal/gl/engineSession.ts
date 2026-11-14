import { labJson, awaitLabWrite } from "@/terminal-lab/lib/labReport";
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
import type { AutorunConfig } from "@/terminal-lab/lib/autorun";

export const ENGINE_FAILED_EXIT = -2;
const MAX_QUEUED_INPUT_BYTES = 1024 * 1024;

export type NativeKeyEvent = {
  code: string;
  text?: string;
  action?: "press" | "release" | "repeat";
  mods?: number;
  consumedMods?: number;
  unshifted?: string;
};

type NativeInputEvent =
  | { kind: "key"; event: NativeKeyEvent }
  | { kind: "paste"; text: string }
  | { kind: "focus"; focused: boolean };

export type BenchCreditSender = (
  id: number,
  seq: number,
  drawnAt: number,
  onDispatch: (at: number) => void,
) => Promise<void>;

export function registerLabCredits(
  credits: { id: number; seq: number }[],
): Promise<void> {
  return invoke("gterm_lab_credits", { credits });
}

export type BenchKind = "ascii" | "sgr" | "tui";

export type EngineColors = {
  foreground: string;
  background: string;
  cursor?: string;
  palette: string[];
};

export type BenchStats = {
  bytesFed: number;
  frames: number;
  frameBytes: number;
  encodeMicros: number;
  sendMicros: number;
  creditWaitMicros: number;
  credits: number;
  scrollbackRows: number | null;
};

export type FrameEvent = {
  seq: number;
  bytes: number;
  receivedAt: number;
  /** Valid only during the callback; null when the frame did not decode. */
  frame: DecodedFrame | null;
};

export type FrameTiming = {
  seq: number;
  decodeMs: number;
  applyMs: number;
  validationWaitMs?: number;
  readyAt: number;
};

export type SessionObserver = {
  onFrameTiming?: (timing: FrameTiming) => void;
  onCreditReply?: (seq: number, at: number, ok: boolean) => void;
  onFrame?: (event: FrameEvent) => void;
  onDrawn?: (at: number, seq: number | null) => void;
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
export async function submitLabReport(report: unknown): Promise<void> {
  return awaitLabWrite(invoke("gterm_lab_report", { json: labJson(report) }));
}

export function labConfig(): Promise<AutorunConfig> {
  return invoke("gterm_lab_config");
}

export async function labStatus(status: unknown): Promise<void> {
  return awaitLabWrite(invoke("gterm_lab_status", { json: labJson(status) }));
}

export function labFixture(
  kind: BenchKind,
  megabytes: number,
  rows: number,
): Promise<{ path: string; bytes: number }> {
  return invoke("gterm_lab_fixture", { kind, megabytes, rows });
}

export function saveLabCapture(
  pane: "engine" | "xterm",
  uri: string,
): Promise<void> {
  const bytes = Uint8Array.from(atob(uri.slice(uri.indexOf(",") + 1)), (c) =>
    c.charCodeAt(0),
  );
  return invoke("gterm_lab_capture", bytes, {
    headers: { "x-lab-pane": pane },
  });
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
  private readonly failures = new Channel<string>();
  private readonly isBench: boolean;
  private awaitingDraw: number[] = [];
  private latestAppliedSeq: number | null = null;
  private lastDrawnSeq: number | null = null;
  private drawnUnsent: { seq: number; drawnAt: number }[] = [];
  private fullRequested = false;
  private closed = false;
  private failed = false;
  private size: { cols: number; rows: number };
  private pendingColors: EngineColors | null = null;
  private inputWrites: Promise<void> = Promise.resolve();
  private queuedInputBytes = 0;

  private constructor(
    renderer: GridRenderer,
    observer: SessionObserver,
    size: { cols: number; rows: number },
    isBench: boolean,
    private readonly sendCredit?: BenchCreditSender,
  ) {
    this.renderer = renderer;
    this.observer = observer;
    this.size = size;
    this.isBench = isBench;
    this.pane = renderer.addPane({
      onNeedFullFrame: () => this.requestFull(),
      onDrawn: (rendered) => this.handleDrawn(rendered),
    });
    this.frames.onmessage = (buffer) => this.receive(buffer);
    this.failures.onmessage = (message) => this.failCore(message);
    this.exits.onmessage = (code) => {
      if (this.exitCode !== null) return;
      this.exitCode = code;
      if (code === ENGINE_FAILED_EXIT) this.failCore("terminal engine failed");
      try {
        this.observer.onExit?.(code);
      } catch {
        console.error("terminal engine exit observer failed");
      }
    };
  }

  static async open(
    renderer: GridRenderer,
    options: {
      cols: number;
      rows: number;
      cwd?: string;
      observer?: SessionObserver;
      colors?: EngineColors;
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
      colors: options.colors ?? null,
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
      colors?: EngineColors;
      sendCredit?: BenchCreditSender;
    },
  ): Promise<EngineSession> {
    const session = new EngineSession(
      renderer,
      options.observer ?? {},
      { cols: options.cols, rows: options.rows },
      true,
      options.sendCredit,
    );
    return session.start("gterm_bench_open", {
      kind: options.kind,
      megabytes: options.megabytes,
      colors: options.colors ?? null,
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
        onFailure: this.failures,
      });
    } catch (error) {
      this.release();
      throw error;
    }
    if (this.closed || this.failed) {
      const failed = this.failed;
      this.release();
      void this.closeById(this.id).catch(() => {});
      throw new Error(
        failed ? "terminal engine failed" : "session closed while opening",
      );
    }
    if (
      !this.isBench &&
      (this.size.cols !== args.cols || this.size.rows !== args.rows)
    ) {
      invoke("gterm_resize", { id: this.id, ...this.size }).catch(
        this.reportError,
      );
    }
    if (this.pendingColors) this.setColors(this.pendingColors);
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
    if (this.closed || this.failed) return;
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
    const decodedAt = this.observer.onFrameTiming
      ? performance.now()
      : receivedAt;
    let applied = false;
    if (frame) {
      if (frame.full) this.fullRequested = false;
      try {
        applied = this.renderer.applyFrame(this.pane, frame) === "applied";
        if (applied) this.latestAppliedSeq = seq;
      } catch (error) {
        this.observer.onError?.(error);
      }
    }
    const readyAt = this.observer.onFrameTiming ? performance.now() : decodedAt;
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
    this.observer.onFrameTiming?.({
      seq,
      decodeMs: decodedAt - receivedAt,
      applyMs: readyAt - decodedAt,
      readyAt,
    });
  }

  private handleDrawn(rendered = true): void {
    const at = performance.now();
    if (this.awaitingDraw.length > 0) {
      for (const seq of this.awaitingDraw)
        this.drawnUnsent.push({ seq, drawnAt: at });
      this.awaitingDraw = [];
    }
    const seq =
      rendered && this.latestAppliedSeq !== this.lastDrawnSeq
        ? this.latestAppliedSeq
        : null;
    if (seq !== null) this.lastDrawnSeq = seq;
    this.observer.onDrawn?.(at, seq);
    this.flushCredits();
  }

  private flushCredits(): void {
    const id = this.id;
    if (
      id === null ||
      this.closed ||
      this.failed ||
      this.drawnUnsent.length === 0
    )
      return;
    const seqs = this.drawnUnsent;
    this.drawnUnsent = [];
    for (const { seq, drawnAt } of seqs) {
      let sent: Promise<unknown>;
      if (this.sendCredit) {
        sent = this.sendCredit(id, seq, drawnAt, (at) => {
          if (this.failed) throw new Error("terminal engine failed");
          if (this.closed)
            throw new Error("session closed before credit dispatch");
          this.observer.onCredit?.(seq, at);
        });
      } else {
        this.observer.onCredit?.(seq, performance.now());
        sent = invoke("gterm_credit", { id, seq });
      }
      if (this.observer.onCreditReply) {
        sent.then(
          () => {
            if (!this.closed)
              this.observer.onCreditReply?.(seq, performance.now(), true);
          },
          (error) => {
            if (!this.closed)
              this.observer.onCreditReply?.(seq, performance.now(), false);
            this.reportError(error);
          },
        );
      } else sent.catch(this.reportError);
    }
  }

  private failCore(message: string): void {
    if (this.closed || this.failed) return;
    this.failed = true;
    this.awaitingDraw = [];
    this.drawnUnsent = [];
    try {
      this.observer.onError?.(new Error(message));
    } catch {
      console.error("terminal engine error observer failed");
    }
  }

  private readonly reportError = (error: unknown): void => {
    if (!this.closed) this.observer.onError?.(error);
  };

  requestFull(): void {
    const id = this.id;
    if (id === null || this.closed || this.failed || this.fullRequested) return;
    this.fullRequested = true;
    invoke("gterm_request_full", { id }).catch(this.reportError);
  }

  write(text: string): Promise<void> {
    if (!text)
      return this.failed
        ? Promise.reject(new Error("terminal engine failed"))
        : Promise.resolve();
    const bytes = textEncoder.encode(text);
    return this.enqueueInput(bytes.byteLength, (id) =>
      this.writeBytes(id, bytes),
    );
  }

  sendKey(event: NativeKeyEvent): Promise<void> {
    return this.sendNativeInput(
      { kind: "key", event: { ...event } },
      64 + textEncoder.encode(event.text ?? "").byteLength,
    );
  }

  paste(text: string): Promise<void> {
    return this.sendNativeInput(
      { kind: "paste", text },
      textEncoder.encode(text).byteLength,
    );
  }

  setInputFocused(focused: boolean): Promise<void> {
    return this.sendNativeInput({ kind: "focus", focused }, 1);
  }

  async encodeKey(event: NativeKeyEvent): Promise<string> {
    const id = this.id;
    if (id === null || this.closed || this.failed || this.exitCode !== null)
      throw new Error("terminal input is unavailable");
    const snapshot = { ...event };
    const text = await this.enqueueInput(
      64 + textEncoder.encode(snapshot.text ?? "").byteLength,
      async (currentId) => {
        const bytes = await this.encodeNativeInput(currentId, {
          kind: "key",
          event: snapshot,
        });
        return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      },
    );
    if (typeof text !== "string")
      throw new Error("terminal input is unavailable");
    return text;
  }

  private sendNativeInput(
    event: NativeInputEvent,
    bytes: number,
  ): Promise<void> {
    return this.enqueueInput(bytes, async (id) => {
      const encoded = await this.encodeNativeInput(id, event);
      if (encoded.byteLength > 0) await this.writeBytes(id, encoded);
    });
  }

  private async encodeNativeInput(
    id: number,
    event: NativeInputEvent,
  ): Promise<Uint8Array> {
    const encoded = await invoke<unknown>("gterm_encode_input", { id, event });
    if (this.id !== id || this.closed || this.failed || this.exitCode !== null)
      throw new Error("terminal input is unavailable");
    if (
      !Array.isArray(encoded) ||
      encoded.length > MAX_QUEUED_INPUT_BYTES + 12 ||
      !encoded.every(
        (byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255,
      )
    )
      throw new Error("invalid native terminal input reply");
    return Uint8Array.from(encoded);
  }

  private enqueueInput<T>(
    bytes: number,
    operation: (id: number) => Promise<T>,
  ): Promise<T | undefined> {
    bytes = Math.max(64, bytes);
    if (this.failed) return Promise.reject(new Error("terminal engine failed"));
    if (this.id === null || this.closed || this.exitCode !== null)
      return Promise.resolve(undefined);
    if (this.queuedInputBytes + bytes > MAX_QUEUED_INPUT_BYTES)
      return Promise.reject(
        new Error(
          "Terminal input queue is full; wait before pasting more text.",
        ),
      );
    this.queuedInputBytes += bytes;
    const task = this.inputWrites
      .then(async () => {
        if (this.failed) throw new Error("terminal engine failed");
        const id = this.id;
        if (id === null || this.closed || this.exitCode !== null) return;
        return operation(id);
      })
      .finally(() => {
        this.queuedInputBytes -= bytes;
      });
    this.inputWrites = task.then(
      () => {},
      () => {},
    );
    return task;
  }

  private writeBytes(id: number, bytes: Uint8Array): Promise<void> {
    if (this.failed) return Promise.reject(new Error("terminal engine failed"));
    if (this.id !== id || this.closed || this.exitCode !== null)
      return Promise.resolve();
    return invoke("pty_write", bytes, { headers: { "x-pty-id": String(id) } });
  }

  setColors(colors: EngineColors): void {
    if (this.closed || this.failed) return;
    this.pendingColors = colors;
    if (this.id === null) return;
    this.pendingColors = null;
    invoke("gterm_set_colors", { id: this.id, colors }).catch(this.reportError);
  }

  resize(cols: number, rows: number): void {
    if (
      this.isBench ||
      this.closed ||
      this.failed ||
      (cols === this.size.cols && rows === this.size.rows)
    )
      return;
    if (this.id === null) {
      this.size = { cols, rows };
      return;
    }
    void this.resizeAndWait(cols, rows).catch(this.reportError);
  }

  resizeAndWait(cols: number, rows: number): Promise<void> {
    if (this.isBench) return Promise.resolve();
    if (this.closed || this.failed)
      return Promise.reject(new Error("terminal engine is unavailable"));
    const id = this.id;
    if (id === null)
      return Promise.reject(new Error("terminal engine is not open"));
    if (cols === this.size.cols && rows === this.size.rows)
      return Promise.resolve();
    this.size = { cols, rows };
    return invoke("gterm_resize", { id, cols, rows });
  }

  scroll(delta: number): void {
    const id = this.id;
    if (id === null || this.closed || this.failed || delta === 0) return;
    invoke("gterm_scroll", { id, delta }).catch(this.reportError);
  }

  readText(maxLines = 200): Promise<string> {
    if (!Number.isInteger(maxLines) || maxLines < 1 || maxLines > 1000)
      return Promise.reject(
        new Error("terminal text line limit must be 1 through 1000"),
      );
    const id = this.id;
    if (id === null || this.closed || this.failed)
      return Promise.reject(new Error("terminal engine is unavailable"));
    return invoke<unknown>("gterm_read_text", { id, maxLines }).then((text) => {
      if (this.closed || this.failed || this.id !== id)
        throw new Error("terminal engine is unavailable");
      if (typeof text !== "string")
        throw new Error("invalid terminal text reply");
      return text;
    });
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
    this.failures.onmessage = noop;
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
