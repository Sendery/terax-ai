import {
  TERMINAL_SCROLLBACK_DEFAULT,
  validateScrollbackRows,
} from "@/modules/settings/terminalScrollback";
import {
  type DecodedFrame,
  decodeFrame,
  peekSeq,
} from "@/modules/terminal/gl/frameCodec";
import type {
  RenderPane,
  TerminalRenderer,
} from "@/modules/terminal/gl/gridRenderer";
import {
  encodeKey,
  encodePaste,
  wheelRows,
} from "@/modules/terminal/gl/keyInput";
import {
  blockActionSelects,
  decodeNativeBlockAction,
  type NativeBlockCommand,
  type NativeBlockReply,
  validateNativeBlockCommand,
} from "@/modules/terminal/gl/nativeBlockActions";
import {
  decodeNativeBlockOutput,
  decodeNativeBlocks,
  type NativeBlockSnapshot,
  validateNativeBlockId,
} from "@/modules/terminal/gl/nativeBlocks";
import { NativeClipboardRelay } from "@/modules/terminal/gl/nativeClipboard";
import {
  decodeNativeLinkContext,
  type NativeLinkContext,
} from "@/modules/terminal/gl/nativeLinks";
import {
  type NativeSearchCommand,
  validateSearchCommand,
} from "@/modules/terminal/gl/nativeSearch";
import {
  decodeNativeState,
  type NativeState,
} from "@/modules/terminal/gl/nativeState";
import { RenderCapacityError } from "@/modules/terminal/gl/renderCapacity";
import { writeTerminalClipboard } from "@/modules/terminal/lib/terminalClipboard";
import { currentWorkspaceEnv } from "@/modules/workspace";
import type { AutorunConfig } from "@/terminal-lab/lib/autorun";
import { awaitLabWrite, labJson } from "@/terminal-lab/lib/labReport";
import { Channel, invoke } from "@tauri-apps/api/core";

export const ENGINE_FAILED_EXIT = -2;
const MAX_QUEUED_INPUT_BYTES = 1024 * 1024;
/**
 * Every grid resize reaches the program as SIGWINCH, and TUIs that repaint on
 * it (Claude Code, Gemini CLI, zsh's prompt) leave a copy of what was on
 * screen in the history each time. A drag or an animated panel would send one
 * per frame, so resizes are coalesced: a change after a quiet period applies
 * at once, and the rest of the gesture applies once it settles.
 */
export const RESIZE_SETTLE_MS = 120;
const RESIZE_QUIET_MS = 250;

export type NativeKeyEvent = {
  code: string;
  text?: string;
  action?: "press" | "release" | "repeat";
  mods?: number;
  consumedMods?: number;
  unshifted?: string;
  legacyShiftEnter?: boolean;
};

export type NativeMouseEvent = {
  repeat?: number;
  action: "press" | "release" | "motion";
  button: number | null;
  buttons: number;
  mods: number;
  x: number;
  y: number;
  cellWidth: number;
  cellHeight: number;
  screenWidth: number;
  screenHeight: number;
};

export type NativeCursorTarget = {
  col: number;
  row: number;
  cols: number;
  rows: number;
  cursorX: number;
  cursorY: number;
};

export type NativeSelectionCommand =
  | {
      kind: "press";
      col: number;
      row: number;
      x: number;
      y: number;
      atMs: number;
    }
  | {
      kind: "drag";
      col: number;
      row: number;
      x: number;
      y: number;
      cellWidth: number;
      paddingLeft: number;
      screenHeight: number;
      rectangle: boolean;
    }
  | { kind: "word"; col: number; row: number }
  | { kind: "all" | "clear" | "read" | "release" };

type NativeInputEvent =
  | { kind: "key"; event: NativeKeyEvent }
  | { kind: "paste"; text: string }
  | { kind: "mouse"; event: NativeMouseEvent }
  | { kind: "moveCursor"; event: NativeCursorTarget }
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
  onState?: (state: NativeState) => void;
  onHistoryChange?: () => void;
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

export type NativeCaptureFrame = {
  readonly frame: DecodedFrame;
  readonly blocks: NativeBlockSnapshot | null;
  current: () => boolean;
  release: () => void;
};
type CaptureConsumer = {
  frame: DecodedFrame | null;
  hold: boolean;
  current: () => boolean;
  accept: (frame: DecodedFrame, blocks: NativeBlockSnapshot | null) => void;
  cancel: (error: unknown) => void;
  blocks: boolean;
  cols: number;
  rows: number;
};

const textEncoder = new TextEncoder();
const noop = () => {};

/**
 * One terminal on the Rust engine drawn into one pane of a shared renderer.
 * The only place that talks to the engine commands. Credits follow the
 * contract: a frame is applied, the next animation frame draws it, and only
 * then is its credit returned.
 */
export class EngineSession {
  private renderPane: RenderPane;
  id: number | null = null;
  exitCode: number | null = null;
  private renderer: TerminalRenderer;
  private readonly observer: SessionObserver;
  private readonly frames = new Channel<ArrayBuffer>();
  private readonly exits = new Channel<number>();
  private readonly failures = new Channel<string>();
  private readonly states = new Channel<unknown>();
  private readonly clipboardSignals = new Channel<unknown>();
  private readonly clipboardWrites: NativeClipboardRelay;
  private inputStateValue: NativeState | null = null;
  private readonly isBench: boolean;
  private awaitingDraw: number[] = [];
  private latestAppliedSeq: number | null = null;
  private lastDrawnSeq: number | null = null;
  private latestAppliedSize: { cols: number; rows: number } | null = null;
  private lastDrawnSize: { cols: number; rows: number } | null = null;
  private drawnUnsent: { seq: number; drawnAt: number }[] = [];
  private fullRequested = false;
  private captureConsumer: CaptureConsumer | null = null;
  private closed = false;
  private failed = false;
  private size: { cols: number; rows: number };
  private pendingResize: { cols: number; rows: number } | null = null;
  private resizeTimer: ReturnType<typeof setTimeout> | null = null;
  private lastResizeRequestAt = Number.NEGATIVE_INFINITY;
  private pendingColors: EngineColors | null = null;
  private cursorBlinkPreference = false;
  private pendingCursorBlink: boolean | null = null;
  private inputWrites: Promise<void> = Promise.resolve();
  private queuedInputBytes = 0;
  private closing: Promise<void> | null = null;
  private selectionVersion = 0;
  private selectionMutationVersion = 0;
  private selectionSnapshotVersion = 0;
  private selectionQueries: Promise<void> = Promise.resolve();
  private selectionPending = 0;
  private linkPending = 0;
  private blockPending = 0;
  private selectionSnapshot: string | null = null;
  private desiredScrollbackRows = TERMINAL_SCROLLBACK_DEFAULT;
  private rowsInFlight: {
    rows: number;
    ack: boolean;
    applied: boolean;
  } | null = null;
  private failedScrollbackRows: number | null = null;
  private historyAttempted = false;
  private historyUncertain = false;
  private historyEpoch = 0;
  private hostMutationCutoff: number | null = null;
  private clearPending = false;
  private selectionRefreshNeeded = false;
  private selectionRefreshing = false;

  private constructor(
    renderer: TerminalRenderer,
    observer: SessionObserver,
    size: { cols: number; rows: number },
    isBench: boolean,
    private readonly sendCredit?: BenchCreditSender,
  ) {
    this.renderer = renderer;
    this.observer = observer;
    this.size = size;
    this.isBench = isBench;
    this.clipboardWrites = new NativeClipboardRelay({
      current: () =>
        this.id !== null && !this.closed && !this.failed && !this.isBench,
      take: async () => {
        const id = this.id;
        if (id === null) return null;
        const text = await invoke("gterm_take_clipboard_write", { id });
        return this.id === id && !this.closed && !this.failed ? text : null;
      },
      write: (text) =>
        writeTerminalClipboard(
          text,
          () =>
            this.id !== null && !this.closed && !this.failed && !this.isBench,
        ),
    });
    this.clipboardSignals.onmessage = (signal) => {
      if (signal === 1) this.clipboardWrites.notify();
    };
    this.renderPane = renderer.addPane({
      onNeedFullFrame: () => {
        this.invalidatePresented();
        this.requestFull();
      },
      onDrawn: (rendered) => this.handleDrawn(rendered),
      onError: this.reportRenderError,
    });
    this.frames.onmessage = (buffer) => this.receive(buffer);
    this.failures.onmessage = (message) => this.failCore(message);
    this.states.onmessage = (value) => {
      if (this.closed || this.failed) return;
      try {
        this.acceptState(value);
      } catch {
        this.failCore("invalid native terminal state");
      }
    };
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
    renderer: TerminalRenderer,
    options: {
      cols: number;
      rows: number;
      cwd?: string;
      blocks?: boolean;
      observer?: SessionObserver;
      colors?: EngineColors;
      cursorBlink?: boolean;
      scrollbackRows?: number;
    },
  ): Promise<EngineSession> {
    const scrollbackRows =
      options.scrollbackRows ?? TERMINAL_SCROLLBACK_DEFAULT;
    validateScrollbackRows(scrollbackRows);
    const session = new EngineSession(
      renderer,
      options.observer ?? {},
      { cols: options.cols, rows: options.rows },
      false,
    );
    session.cursorBlinkPreference = options.cursorBlink ?? false;
    session.desiredScrollbackRows = scrollbackRows;
    return session.start("gterm_open", {
      cols: options.cols,
      rows: options.rows,
      cwd: options.cwd ?? null,
      blocks: options.blocks ?? false,
      workspace: currentWorkspaceEnv(),
      colors: options.colors ?? null,
      cursorBlink: session.cursorBlinkPreference,
      scrollbackRows,
    });
  }

  static async openBench(
    renderer: TerminalRenderer,
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
        onState: this.states,
        ...(this.isBench ? {} : { onClipboard: this.clipboardSignals }),
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
      (this.size.cols !== args.cols ||
        this.size.rows !== args.rows ||
        this.cellPixelsKnown ||
        this.cellPixels.width !== 8 ||
        this.cellPixels.height !== 16)
    ) {
      invoke("gterm_resize", {
        id: this.id,
        ...this.size,
        cellWidth: this.cellPixels.width,
        cellHeight: this.cellPixels.height,
      }).catch(this.reportError);
    }
    if (this.pendingColors) this.setColors(this.pendingColors);
    this.flushCursorBlink();
    this.flushScrollbackRows();
    this.flushCredits();
    this.clipboardWrites.resume();
    return this;
  }

  get pane(): RenderPane {
    return this.renderPane;
  }

  attachRenderer(renderer: TerminalRenderer): void {
    if (this.closed || this.failed)
      throw new Error("Terminal is no longer available.");
    if (renderer === this.renderer) return;
    let pane: RenderPane;
    try {
      pane = renderer.addPane({
        onNeedFullFrame: () => {
          this.invalidatePresented();
          this.requestFull();
        },
        onDrawn: (rendered) => this.handleDrawn(rendered),
        onError: this.reportRenderError,
      });
    } catch (error) {
      this.failCore("terminal renderer migration failed");
      throw error;
    }
    this.captureConsumer?.cancel(new Error("Terminal capture owner changed."));
    this.renderer.removePane(this.renderPane);
    this.renderer = renderer;
    this.renderPane = pane;
    renderer.setPaneFocused(pane, false);
    this.latestAppliedSeq = null;
    this.lastDrawnSeq = null;
    this.lastDrawnSize = null;
    this.fullRequested = false;
    this.requestFull();
    if (this.awaitingDraw.length > 0) renderer.markUndrawn(this.renderPane);
  }

  get cursor(): { x: number; y: number } | null {
    const header = this.pane.header;
    return header ? { x: header.cursorX, y: header.cursorY } : null;
  }

  get grid(): { cols: number; rows: number } {
    return this.size;
  }

  private invalidatePresented(): void {
    this.latestAppliedSeq = null;
    this.lastDrawnSeq = null;
    this.latestAppliedSize = null;
    this.lastDrawnSize = null;
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
    const staleHistory =
      frame !== null && !this.frameAfterHostMutation(frame.seq);
    if (frame?.full) this.fullRequested = false;
    if (frame && !staleHistory) this.captureFull(frame);
    let applied = false;
    let capacityBlocked = false;
    if (frame && !staleHistory) {
      try {
        const result = this.renderer.applyFrame(this.pane, frame);
        applied = result === "applied";
        capacityBlocked = result === "blocked";
        if (applied) {
          this.latestAppliedSeq = seq;
          this.latestAppliedSize = { cols: frame.cols, rows: frame.rows };
        }
      } catch (error) {
        capacityBlocked = error instanceof RenderCapacityError;
        this.observer.onError?.(error);
      }
    }
    const readyAt = this.observer.onFrameTiming ? performance.now() : decodedAt;
    this.awaitingDraw.push(seq);
    if (!applied) {
      // Return credit after a display turn. Blocked capacity awaits explicit
      // recovery instead of scheduling another full frame.
      this.invalidatePresented();
      // Hidden renderers intentionally discard the grid. Their reveal path
      // requests a full frame; requesting one here would form a full/ACK loop.
      if (
        !capacityBlocked &&
        (Boolean(staleHistory && this.captureConsumer) ||
          !(this.pane.rect.width <= 0 || this.pane.rect.height <= 0))
      )
        this.requestFull();
      this.renderer.markUndrawn(this.pane);
    }
    this.observer.onFrame?.({
      seq,
      bytes: buffer.byteLength,
      receivedAt,
      frame: staleHistory ? null : frame,
    });
    this.observer.onFrameTiming?.({
      seq,
      decodeMs: decodedAt - receivedAt,
      applyMs: readyAt - decodedAt,
      readyAt,
    });
  }

  private readonly reportRenderError = (error: unknown): void => {
    if (this.closed || this.failed) return;
    this.invalidatePresented();
    this.reportError(error);
  };

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
    if (seq !== null) {
      this.lastDrawnSeq = seq;
      this.lastDrawnSize = this.latestAppliedSize;
    }
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
    const held = this.captureConsumer?.hold
      ? this.captureConsumer.frame?.seq
      : null;
    const seqs = this.drawnUnsent.filter((item) => item.seq !== held);
    this.drawnUnsent = this.drawnUnsent.filter((item) => item.seq === held);
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
    this.selectionMutationVersion++;
    this.captureConsumer?.cancel(new Error(message));
    this.selectionSnapshot = null;
    this.inputStateValue = null;
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

  requestFull(retryCapacity = false): void {
    if (retryCapacity) this.renderer.retryCapacity?.();
    const id = this.id;
    if (id === null || this.closed || this.failed || this.fullRequested) return;
    this.fullRequested = true;
    invoke("gterm_request_full", { id }).catch((error) => {
      this.fullRequested = false;
      this.captureConsumer?.cancel(error);
      this.reportError(error);
    });
  }

  /** Internal one-shot full consumer; it never changes the live pane or drawnSeq. */
  captureFrame(options: {
    signal: AbortSignal;
    blocks?: boolean;
    current?: () => boolean;
  }): Promise<NativeCaptureFrame> {
    if (this.captureConsumer)
      return Promise.reject(
        new Error("Terminal capture is already in progress."),
      );
    if (!this.historyAvailable)
      return Promise.reject(new Error("Terminal history is changing."));
    const epoch = this.historyEpoch;
    const id = this.id;
    const pane = this.pane;
    const { cols, rows } = this.size;
    return new Promise((resolve, reject) => {
      let done = false;
      let settled = false;
      const current = () => {
        try {
          return (
            !done &&
            !options.signal.aborted &&
            id !== null &&
            this.id === id &&
            !this.closed &&
            !this.failed &&
            this.historyAvailable &&
            this.historyEpoch === epoch &&
            this.pane === pane &&
            this.size.cols === cols &&
            this.size.rows === rows &&
            (pane.rect.width <= 0 || pane.rect.height <= 0) &&
            (options.current?.() ?? true)
          );
        } catch {
          return false;
        }
      };
      const release = () => {
        if (done) return;
        done = true;
        options.signal.removeEventListener("abort", abort);
        if (this.captureConsumer === consumer) this.captureConsumer = null;
        consumer.hold = false;
        this.flushCredits();
      };
      const cancel = (error: unknown) => {
        release();
        if (!settled) {
          settled = true;
          reject(error);
        }
      };
      const abort = () => cancel(new Error("Terminal capture was cancelled."));
      const consumer: CaptureConsumer = {
        frame: null,
        hold: false,
        current,
        cancel,
        cols,
        rows,
        blocks: options.blocks ?? false,
        accept: (frame, blocks) => {
          if (!current()) {
            cancel(new Error("Terminal capture is no longer available."));
            return;
          }
          settled = true;
          resolve({ frame, blocks, current, release });
        },
      };
      if (!current()) {
        cancel(new Error("Terminal capture is no longer available."));
        return;
      }
      this.captureConsumer = consumer;
      options.signal.addEventListener("abort", abort, { once: true });
      // Any earlier hidden packet must finish its existing display turn before
      // the core can produce the requested full. This is not a second ACK path.
      if (this.awaitingDraw.length) this.renderer.markUndrawn(pane);
      this.requestFull();
    });
  }

  private captureFull(frame: DecodedFrame): void {
    const consumer = this.captureConsumer;
    if (!consumer || consumer.frame || !frame.full) return;
    if (
      !consumer.current() ||
      frame.cols !== consumer.cols ||
      frame.rows !== consumer.rows
    ) {
      consumer.cancel(new Error("Terminal capture geometry changed."));
      return;
    }
    consumer.frame = frame;
    consumer.hold = consumer.blocks;
    const blocks = consumer.blocks
      ? this.blockQuery("gterm_blocks", { seq: frame.seq }, (value) => {
          const snapshot = decodeNativeBlocks(value, frame.seq);
          if (snapshot.viewportRows !== frame.rows)
            throw new Error("Invalid terminal capture block projection.");
          return snapshot;
        })
      : Promise.resolve(null);
    void blocks
      .then((snapshot) => {
        consumer.hold = false;
        this.flushCredits();
        consumer.accept(frame, snapshot);
      })
      .catch(consumer.cancel);
  }

  write(text: string, current: () => boolean = () => true): Promise<void> {
    if (!text)
      return this.failed
        ? Promise.reject(new Error("terminal engine failed"))
        : Promise.resolve();
    const bytes = textEncoder.encode(text);
    return this.enqueueInput(bytes.byteLength, (id) =>
      this.writeBytes(id, bytes, current),
    );
  }

  sendKey(event: NativeKeyEvent): Promise<void> {
    return this.sendNativeInput(
      { kind: "key", event: { ...event } },
      64 + textEncoder.encode(event.text ?? "").byteLength,
    );
  }

  sendMouse(event: NativeMouseEvent): Promise<void> {
    const repeat = event.repeat ?? 1;
    if (!Number.isInteger(repeat) || repeat < 1 || repeat > 32)
      return Promise.reject(new Error("invalid native mouse repeat"));
    return this.sendNativeInput(
      { kind: "mouse", event: { ...event } },
      128 * (event.repeat ?? 1),
    );
  }

  moveCursor(event: NativeCursorTarget, current: () => boolean): Promise<void> {
    return this.sendNativeInput(
      { kind: "moveCursor", event: { ...event } },
      128,
      current,
    );
  }

  paste(text: string): Promise<void> {
    return this.sendNativeInput(
      { kind: "paste", text },
      textEncoder.encode(text).byteLength,
    );
  }

  submit(
    text: string,
    current: () => boolean = () => true,
    onWriteAttempt?: () => void,
  ): Promise<void> {
    if (!text)
      return this.enqueueInput(1, (id) =>
        this.writeBytes(id, Uint8Array.of(13), current, onWriteAttempt),
      );
    return this.enqueueInput(
      textEncoder.encode(text).byteLength + 1,
      async (id) => {
        if (!current()) throw new Error("terminal input is unavailable");
        const paste = await this.encodeNativeInput(id, { kind: "paste", text });
        const bytes = new Uint8Array(paste.length + 1);
        bytes.set(paste);
        bytes[paste.length] = 13;
        await this.writeBytes(id, bytes, current, onWriteAttempt);
      },
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
    current: () => boolean = () => true,
  ): Promise<void> {
    return this.enqueueInput(bytes, async (id) => {
      if (!current()) return;
      const encoded = await this.encodeNativeInput(id, event);
      if (encoded.byteLength > 0) await this.writeBytes(id, encoded, current);
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

  private writeBytes(
    id: number,
    bytes: Uint8Array,
    current: () => boolean = () => true,
    onWriteAttempt?: () => void,
  ): Promise<void> {
    if (this.failed) return Promise.reject(new Error("terminal engine failed"));
    if (this.id !== id || this.closed || this.exitCode !== null)
      return Promise.resolve();
    if (!current())
      return Promise.reject(new Error("terminal input is unavailable"));
    onWriteAttempt?.();
    return invoke("pty_write", bytes, { headers: { "x-pty-id": String(id) } });
  }

  setColors(colors: EngineColors): void {
    if (this.closed || this.failed) return;
    this.pendingColors = colors;
    if (this.id === null) return;
    this.pendingColors = null;
    invoke("gterm_set_colors", { id: this.id, colors }).catch(this.reportError);
  }

  setCursorBlink(enabled: boolean): void {
    if (
      this.closed ||
      this.failed ||
      this.isBench ||
      enabled === this.cursorBlinkPreference
    )
      return;
    this.cursorBlinkPreference = enabled;
    this.pendingCursorBlink = enabled;
    this.flushCursorBlink();
  }

  private flushCursorBlink(): void {
    if (
      this.id === null ||
      this.pendingCursorBlink === null ||
      this.closed ||
      this.failed ||
      this.isBench
    )
      return;
    const enabled = this.pendingCursorBlink;
    this.pendingCursorBlink = null;
    invoke("gterm_set_cursor_blink", { id: this.id, enabled }).catch(
      this.reportError,
    );
  }

  /** Applied state, not the setter admission ACK, permits history consumers. */
  get historyAvailable(): boolean {
    if (
      this.closed ||
      this.failed ||
      this.clearPending ||
      this.historyUncertain
    )
      return false;
    if (this.isBench) return true;
    const rows = this.inputStateValue?.scrollbackRows;
    if (rows === undefined) return !this.historyAttempted;
    return (
      rows === this.desiredScrollbackRows &&
      (!this.rowsInFlight || this.rowsInFlight.applied)
    );
  }

  setScrollbackRows(rows: number): void {
    validateScrollbackRows(rows);
    if (
      this.closed ||
      this.failed ||
      this.isBench ||
      rows === this.desiredScrollbackRows
    )
      return;
    this.desiredScrollbackRows = rows;
    this.failedScrollbackRows = null;
    this.historyAttempted = true;
    this.beginHistoryMutation();
    this.flushScrollbackRows();
    this.historySettled();
  }

  private flushScrollbackRows(): void {
    if (
      this.closed ||
      this.failed ||
      this.isBench ||
      this.id === null ||
      this.rowsInFlight ||
      this.failedScrollbackRows === this.desiredScrollbackRows
    )
      return;
    const applied = this.inputStateValue?.scrollbackRows;
    if (typeof applied !== "number" || applied === this.desiredScrollbackRows)
      return;
    const pending = {
      rows: this.desiredScrollbackRows,
      ack: false,
      applied: false,
    };
    this.rowsInFlight = pending;
    void invoke("gterm_set_scrollback_rows", {
      id: this.id,
      rows: pending.rows,
    })
      .catch((error: unknown) => {
        if (this.closed || this.failed || this.rowsInFlight !== pending) return;
        // A rejected sync command leaves no live pending control. Retire it
        // without retrying the failed target on unrelated state publications.
        this.rowsInFlight = null;
        this.failedScrollbackRows = pending.rows;
        this.reportError(error);
        this.flushScrollbackRows(); // A different, explicitly queued target only.
        this.historySettled();
      })
      .finally(() => {
        if (this.closed || this.failed || this.rowsInFlight !== pending) return;
        pending.ack = true;
        this.completeScrollbackRows();
      });
  }

  private completeScrollbackRows(): void {
    if (this.rowsInFlight?.ack && this.rowsInFlight.applied) {
      this.rowsInFlight = null;
      this.flushScrollbackRows();
    }
    this.historySettled();
  }

  private beginHistoryMutation(): void {
    this.historyEpoch++;
    this.captureConsumer?.cancel(
      new Error("Terminal history changed during capture."),
    );
    if (this.selectionSnapshot !== null) this.selectionRefreshNeeded = true;
    this.selectionVersion++;
    this.selectionMutationVersion++;
    this.selectionSnapshot = null;
    this.notifyHistoryChange();
  }

  private notifyHistoryChange(): void {
    try {
      this.observer.onHistoryChange?.();
    } catch {
      console.error("terminal history observer failed");
    }
  }

  private historySettled(): void {
    this.notifyHistoryChange();
    if (
      !this.historyAvailable ||
      !this.selectionRefreshNeeded ||
      this.selectionRefreshing
    )
      return;
    this.selectionRefreshNeeded = false;
    this.selectionRefreshing = true;
    void this.select({ kind: "read" })
      .catch(this.reportError)
      .finally(() => {
        this.selectionRefreshing = false;
        if (this.selectionRefreshNeeded) this.historySettled();
      });
  }

  private frameAfterHostMutation(seq: number): boolean {
    if (this.hostMutationCutoff === null) return true;
    const distance = (seq - this.hostMutationCutoff) >>> 0;
    return distance > 0 && distance < 0x80000000;
  }

  private assertHistory(epoch: number): void {
    if (this.historyEpoch !== epoch || !this.historyAvailable)
      throw new Error("Terminal history changed during the request.");
  }

  /** Host clear, never terminal input. A false reply is a genuine core no-op. */
  async clear(current: () => boolean = () => true): Promise<boolean> {
    const id = this.id;
    if (id === null || this.closed || this.failed || this.isBench)
      throw new Error("Terminal engine is unavailable.");
    if (!current()) return false;
    if (this.clearPending)
      throw new Error("Terminal clear is already in progress.");
    const before = this.inputStateValue?.hostMutationVersion;
    this.clearPending = true;
    this.historyUncertain = true;
    this.beginHistoryMutation();
    try {
      // No await may intervene between the owner/focus guard and target IPC.
      if (!current()) {
        this.historyUncertain = false;
        return false;
      }
      const changed = await invoke<unknown>("gterm_clear", { id });
      if (this.id !== id || this.closed || this.failed)
        throw new Error("Terminal engine is unavailable.");
      if (typeof changed !== "boolean")
        throw new Error("Invalid terminal clear reply.");
      if (changed) {
        const state = await this.readState();
        if (
          before === undefined ||
          state.hostMutationVersion === undefined ||
          state.hostMutationVersion <= before
        )
          throw new Error("Terminal clear has no applied history receipt.");
      }
      this.historyUncertain = false;
      return changed;
    } finally {
      this.clearPending = false;
      this.historySettled();
    }
  }

  private cellPixels = { width: 8, height: 16 };
  private cellPixelsKnown = false;

  setCellPixels(width: number, height: number): void {
    if (
      this.closed ||
      this.failed ||
      this.isBench ||
      (this.cellPixelsKnown &&
        width === this.cellPixels.width &&
        height === this.cellPixels.height)
    )
      return;
    this.cellPixelsKnown = true;
    this.cellPixels = { width, height };
    if (this.id === null) return;
    invoke("gterm_resize", {
      id: this.id,
      ...this.size,
      cellWidth: width,
      cellHeight: height,
      metricsOnly: true,
    }).catch(this.reportError);
  }

  resize(cols: number, rows: number): void {
    if (this.isBench || this.closed || this.failed) return;
    if (this.id === null) {
      this.size = { cols, rows };
      return;
    }
    const same = cols === this.size.cols && rows === this.size.rows;
    // Layout passes re-report an unchanged size; those are not a gesture.
    if (same && this.pendingResize === null) return;
    const now = performance.now();
    const quiet = now - this.lastResizeRequestAt >= RESIZE_QUIET_MS;
    this.lastResizeRequestAt = now;
    if (quiet && this.resizeTimer === null) {
      void this.resizeAndWait(cols, rows).catch(this.reportError);
      return;
    }
    // Inside a gesture: keep only the latest size until it settles. A gesture
    // that ends where it started sends nothing.
    this.pendingResize = { cols, rows };
    if (this.resizeTimer !== null) clearTimeout(this.resizeTimer);
    this.resizeTimer = setTimeout(this.applyPendingResize, RESIZE_SETTLE_MS);
  }

  private readonly applyPendingResize = (): void => {
    this.resizeTimer = null;
    const pending = this.pendingResize;
    this.pendingResize = null;
    if (!pending || this.closed || this.failed || this.id === null) return;
    void this.resizeAndWait(pending.cols, pending.rows).catch(this.reportError);
  };

  private cancelPendingResize(): void {
    if (this.resizeTimer !== null) clearTimeout(this.resizeTimer);
    this.resizeTimer = null;
    this.pendingResize = null;
  }

  resizeAndWait(cols: number, rows: number): Promise<void> {
    if (this.isBench) return Promise.resolve();
    this.cancelPendingResize();
    if (this.closed || this.failed)
      return Promise.reject(new Error("terminal engine is unavailable"));
    const id = this.id;
    if (id === null)
      return Promise.reject(new Error("terminal engine is not open"));
    if (cols === this.size.cols && rows === this.size.rows)
      return Promise.resolve();
    this.size = { cols, rows };
    return invoke("gterm_resize", {
      id,
      cols,
      rows,
      cellWidth: this.cellPixels.width,
      cellHeight: this.cellPixels.height,
    });
  }

  scroll(delta: number): void {
    const id = this.id;
    if (id === null || this.closed || this.failed || delta === 0) return;
    invoke("gterm_scroll", { id, delta }).catch(this.reportError);
  }

  get inputState(): NativeState | null {
    return this.closed || this.failed ? null : this.inputStateValue;
  }

  private acceptState(value: unknown): NativeState {
    const state = decodeNativeState(value);
    if (this.inputStateValue && state.version < this.inputStateValue.version)
      return this.inputStateValue;
    if (
      this.inputStateValue &&
      state.version === this.inputStateValue.version &&
      JSON.stringify(state) !== JSON.stringify(this.inputStateValue)
    )
      throw new Error("invalid native terminal state version");
    const changed =
      !this.inputStateValue || state.version !== this.inputStateValue.version;
    const previous = this.inputStateValue;
    if (!this.isBench && state.scrollbackRows === null)
      throw new Error("invalid native terminal row policy");
    if (
      previous?.hostMutationVersion !== undefined &&
      (state.hostMutationVersion === undefined ||
        state.hostMutationVersion < previous.hostMutationVersion)
    )
      throw new Error("invalid native terminal host receipt order");
    if (
      previous?.hostMutationVersion !== undefined &&
      state.hostMutationVersion === previous.hostMutationVersion &&
      (state.scrollbackRows !== previous.scrollbackRows ||
        state.hostMutationAfterSeq !== previous.hostMutationAfterSeq)
    )
      throw new Error("invalid native terminal host receipt version");
    this.inputStateValue = state;
    const applied =
      state.hostMutationVersion !== undefined &&
      state.hostMutationVersion > (previous?.hostMutationVersion ?? 0);
    if (applied) {
      this.hostMutationCutoff = state.hostMutationAfterSeq ?? null;
      this.historyUncertain = false;
      this.beginHistoryMutation();
      this.invalidatePresented();
      this.fullRequested = false;
      this.requestFull();
    }
    if (this.rowsInFlight && state.scrollbackRows === this.rowsInFlight.rows)
      this.rowsInFlight.applied = true;
    this.completeScrollbackRows();
    this.flushScrollbackRows();
    if (changed) {
      try {
        this.observer.onState?.(state);
      } catch {
        console.error("native terminal state observer failed");
      }
    }
    return state;
  }

  async readState(): Promise<NativeState> {
    const id = this.id;
    if (id === null || this.closed || this.failed)
      throw new Error("terminal engine is unavailable");
    const state = await invoke<unknown>("gterm_state", { id });
    if (this.id !== id || this.closed || this.failed)
      throw new Error("terminal engine is unavailable");
    return this.acceptState(state);
  }

  get selectionRevision(): number {
    return this.selectionVersion;
  }

  get selectionMutationRevision(): number {
    return this.selectionMutationVersion;
  }

  getSelection(): string | null {
    return this.historyAvailable ? this.selectionSnapshot : null;
  }

  select(command: NativeSelectionCommand): Promise<string | null> {
    if (this.closed || this.failed || this.id === null)
      return Promise.reject(new Error("terminal engine is unavailable"));
    if (this.selectionPending >= 32)
      return Promise.reject(
        new Error("too many pending terminal selection requests"),
      );
    const epoch = this.historyEpoch;
    try {
      this.assertHistory(epoch);
    } catch (error) {
      return Promise.reject(error);
    }
    const snapshot = { ...command };
    const version = ++this.selectionVersion;
    if (snapshot.kind !== "read") this.selectionMutationVersion++;
    if (command.kind !== "read" && command.kind !== "release")
      this.selectionSnapshot = null;
    this.selectionPending++;
    const task = this.selectionQueries
      .then(async () => {
        const id = this.id;
        if (this.closed || this.failed || id === null)
          throw new Error("terminal engine is unavailable");
        this.assertHistory(epoch);
        try {
          const text = await invoke<unknown>("gterm_selection", {
            id,
            command: snapshot,
          });
          if (this.closed || this.failed || this.id !== id)
            throw new Error("terminal engine is unavailable");
          this.assertHistory(epoch);
          if (
            text !== null &&
            (typeof text !== "string" ||
              textEncoder.encode(text).byteLength > 16 * 1024 * 1024)
          )
            throw new Error("invalid terminal selection reply");
          if (version === this.selectionVersion) {
            const selected =
              typeof text === "string" && text.length > 0 ? text : null;
            if (snapshot.kind === "read" && this.selectionSnapshot !== selected)
              this.selectionMutationVersion++;
            this.selectionSnapshot = selected;
            this.selectionSnapshotVersion = version;
          }
          return text;
        } catch (error) {
          // A native mutation can succeed before formatting fails. Never copy
          // text from the previous selection after an unsuccessful query.
          if (this.selectionSnapshotVersion <= version) {
            if (snapshot.kind === "read" && this.selectionSnapshot !== null)
              this.selectionMutationVersion++;
            this.selectionSnapshot = null;
          }
          throw error;
        }
      })
      .finally(() => {
        this.selectionPending--;
      });
    this.selectionQueries = task.then(
      () => {},
      () => {},
    );
    return task;
  }

  get drawnSeq(): number | null {
    return this.closed || this.failed ? null : this.lastDrawnSeq;
  }
  get drawnGrid(): { seq: number; cols: number; rows: number } | null {
    const seq = this.drawnSeq;
    return seq !== null && this.lastDrawnSize
      ? { seq, ...this.lastDrawnSize }
      : null;
  }
  linkContext(
    seq: number,
    col: number,
    row: number,
  ): Promise<NativeLinkContext | null> {
    if (
      !Number.isInteger(seq) ||
      seq < 1 ||
      seq > 0xffffffff ||
      !Number.isInteger(col) ||
      col < 0 ||
      col >= 1000 ||
      !Number.isInteger(row) ||
      row < 0 ||
      row >= 500
    )
      return Promise.reject(new Error("Invalid terminal link coordinates."));
    const id = this.id;
    if (id === null || this.closed || this.failed)
      return Promise.reject(new Error("Terminal engine is unavailable."));
    if (seq !== this.lastDrawnSeq) return Promise.resolve(null);
    if (this.linkPending >= 32)
      return Promise.reject(
        new Error("Too many pending terminal link queries."),
      );
    const epoch = this.historyEpoch;
    try {
      this.assertHistory(epoch);
    } catch (error) {
      return Promise.reject(error);
    }
    this.linkPending++;
    return invoke<unknown>("gterm_link_context", { id, seq, col, row })
      .then((value) => {
        if (this.closed || this.failed || this.id !== id)
          throw new Error("Terminal engine is unavailable.");
        this.assertHistory(epoch);
        if (this.lastDrawnSeq !== seq) return null;
        return decodeNativeLinkContext(value, seq, col, row);
      })
      .finally(() => {
        this.linkPending--;
      });
  }

  blocks(seq: number): Promise<NativeBlockSnapshot | null> {
    if (!Number.isInteger(seq) || seq < 1 || seq > 0xffffffff)
      return Promise.reject(new Error("invalid native terminal block frame"));
    const grid = this.drawnGrid;
    if (!grid || grid.seq !== seq) return Promise.resolve(null);
    return this.blockQuery("gterm_blocks", { seq }, (value) => {
      if (this.drawnSeq !== seq) return null;
      const snapshot = decodeNativeBlocks(value, seq);
      if (snapshot.viewportRows !== grid.rows)
        throw new Error("invalid native terminal block frame size");
      return snapshot;
    });
  }
  readBlock(
    blockId: string,
  ): Promise<ReturnType<typeof decodeNativeBlockOutput>> {
    try {
      validateNativeBlockId(blockId);
    } catch (error) {
      return Promise.reject(error);
    }
    return this.blockQuery(
      "gterm_read_block",
      { blockId },
      decodeNativeBlockOutput,
    );
  }
  blockAction(command: NativeBlockCommand): Promise<NativeBlockReply> {
    try {
      validateNativeBlockCommand(command);
    } catch (error) {
      return Promise.reject(error);
    }
    if (this.id === null || this.closed || this.failed)
      return Promise.reject(new Error("Terminal engine is unavailable."));
    if (this.blockPending >= 32)
      return Promise.reject(
        new Error("Too many pending terminal block queries."),
      );
    const snapshot = { ...command };
    const version = blockActionSelects(snapshot)
      ? ++this.selectionVersion
      : null;
    if (version !== null) {
      this.selectionMutationVersion++;
      this.selectionSnapshot = null;
    }
    return this.blockQuery(
      "gterm_block_action",
      { command: snapshot },
      (value) => {
        const reply = decodeNativeBlockAction(value, snapshot);
        if (reply.kind === "selection" && version === this.selectionVersion) {
          this.selectionSnapshot = reply.selection || null;
          this.selectionSnapshotVersion = version;
        }
        return reply;
      },
      true,
    ).catch((error: unknown) => {
      if (version !== null && this.selectionSnapshotVersion <= version)
        this.selectionSnapshot = null;
      throw error;
    });
  }
  private async blockQuery<T>(
    command: "gterm_blocks" | "gterm_read_block" | "gterm_block_action",
    args: Record<string, unknown>,
    decode: (value: unknown) => T,
    ordered = false,
  ): Promise<T> {
    const id = this.id;
    if (id === null || this.closed || this.failed)
      throw new Error("Terminal engine is unavailable.");
    if (this.blockPending >= 32)
      throw new Error("Too many pending terminal block queries.");
    const epoch = this.historyEpoch;
    this.assertHistory(epoch);
    this.blockPending++;
    const run = async () => {
      this.assertHistory(epoch);
      if (this.id !== id || this.closed || this.failed)
        throw new Error("Terminal engine is unavailable.");
      const value = await invoke<unknown>(command, { id, ...args });
      if (this.id !== id || this.closed || this.failed)
        throw new Error("Terminal engine is unavailable.");
      this.assertHistory(epoch);
      return decode(value);
    };
    const task = ordered ? this.selectionQueries.then(run) : run();
    if (ordered)
      this.selectionQueries = task.then(
        () => {},
        () => {},
      );
    try {
      return await task;
    } finally {
      this.blockPending--;
    }
  }

  search(command: NativeSearchCommand): Promise<boolean> {
    try {
      validateSearchCommand(command);
    } catch (error) {
      return Promise.reject(error);
    }
    const id = this.id;
    if (id === null || this.closed || this.failed)
      return Promise.reject(new Error("terminal engine is unavailable"));
    const epoch = this.historyEpoch;
    try {
      this.assertHistory(epoch);
    } catch (error) {
      return Promise.reject(error);
    }
    return invoke<unknown>("gterm_search", {
      id,
      command: { ...command },
    }).then((found) => {
      if (this.closed || this.failed || this.id !== id)
        throw new Error("terminal engine is unavailable");
      this.assertHistory(epoch);
      if (typeof found !== "boolean")
        throw new Error("invalid terminal search reply");
      return found;
    });
  }

  readText(maxLines = 200): Promise<string> {
    if (!Number.isInteger(maxLines) || maxLines < 1 || maxLines > 1000)
      return Promise.reject(
        new Error("terminal text line limit must be 1 through 1000"),
      );
    const id = this.id;
    if (id === null || this.closed || this.failed)
      return Promise.reject(new Error("terminal engine is unavailable"));
    const epoch = this.historyEpoch;
    try {
      this.assertHistory(epoch);
    } catch (error) {
      return Promise.reject(error);
    }
    return invoke<unknown>("gterm_read_text", { id, maxLines }).then((text) => {
      if (this.closed || this.failed || this.id !== id)
        throw new Error("terminal engine is unavailable");
      this.assertHistory(epoch);
      if (typeof text !== "string")
        throw new Error("invalid terminal text reply");
      return text;
    });
  }

  benchStats(): Promise<BenchStats> {
    if (this.id === null) return Promise.reject(new Error("not open"));
    return invoke<BenchStats>("gterm_bench_stats", { id: this.id });
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    const id = this.id;
    this.release();
    this.closing = id === null ? Promise.resolve() : this.closeById(id);
    return this.closing;
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
    this.cancelPendingResize();
    this.selectionMutationVersion++;
    this.captureConsumer?.cancel(
      new Error("Terminal capture is no longer available."),
    );
    this.clipboardWrites.close();
    this.clipboardSignals.onmessage = noop;
    this.selectionSnapshot = null;
    this.frames.onmessage = noop;
    this.exits.onmessage = noop;
    this.failures.onmessage = noop;
    this.states.onmessage = noop;
    this.inputStateValue = null;
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
  renderer: TerminalRenderer,
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
