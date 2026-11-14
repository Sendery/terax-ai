export type TerminalSize = { cols: number; rows: number };

export type TerminalEngine = {
  readonly id: number | null;
  write: (text: string) => Promise<void>;
  resize: (cols: number, rows: number) => Promise<void>;
  close: () => Promise<void>;
};

export type TerminalEngineObserver = {
  onError: (error: unknown) => void;
  onExit: (code: number) => void;
};

export type TerminalEngineFactory = (
  size: TerminalSize,
  observer: TerminalEngineObserver,
) => Promise<TerminalEngine>;

const PENDING_INPUT_MAX = 256 * 1024;

export class TerminalSessionController {
  private engine: TerminalEngine | null = null;
  private acquiredEngine: TerminalEngine | null = null;
  private readonly acquisition: Promise<TerminalEngine>;
  private retirement: Promise<void> | null = null;
  private size: TerminalSize;
  private appliedSize: TerminalSize;
  private attached = false;
  private layout: Promise<void> | null = null;
  private pendingInput = "";
  private writes: Promise<void> = Promise.resolve();
  private closing: Promise<void> | null = null;
  private closed = false;
  private firstFailure: Error | null = null;
  private firstExit: number | null = null;
  readonly opened: Promise<void>;

  constructor(
    factory: TerminalEngineFactory,
    initial: TerminalSize,
    private readonly observer: Partial<TerminalEngineObserver> = {},
  ) {
    this.size = { ...initial };
    this.appliedSize = { ...initial };
    this.acquisition = Promise.resolve()
      .then(() =>
        factory({ ...initial }, { onError: this.fail, onExit: this.exit }),
      )
      .then((engine) => {
        this.acquiredEngine = engine;
        return engine;
      });
    this.opened = this.acquisition
      .then(async (engine) => {
        if (this.closed) {
          throw new Error("terminal session closed while opening");
        }
        if (this.firstFailure) throw this.firstFailure;
        if (
          !Number.isInteger(engine.id) ||
          engine.id === null ||
          engine.id <= 0 ||
          engine.id > 0xffffffff
        ) {
          throw new Error("terminal engine returned an invalid session id");
        }
        this.engine = engine;
        this.synchronizeSize();
        await this.layoutSettled();
        while (
          this.pendingInput &&
          !this.closed &&
          !this.firstFailure &&
          this.firstExit === null
        ) {
          const pending = this.pendingInput;
          this.pendingInput = "";
          this.enqueue(pending);
          await this.writes;
        }
        this.attached = true;
        if (this.closed)
          throw new Error("terminal session closed while opening");
        if (this.firstFailure) throw this.firstFailure;
      })
      .catch(async (error: unknown) => {
        const failure =
          this.firstFailure ??
          (error instanceof Error ? error : new Error(String(error)));
        this.fail(failure);
        this.engine = null;
        if (this.acquiredEngine)
          await this.retire(this.acquiredEngine).catch(() => {});
        throw failure;
      });
    void this.opened.catch(() => {});
  }

  get id(): number | null {
    return this.closed ? null : (this.engine?.id ?? null);
  }

  get failure(): Error | null {
    return this.firstFailure;
  }

  get exitCode(): number | null {
    return this.firstExit;
  }

  write(text: string): boolean {
    if (this.closed || this.firstFailure || this.firstExit !== null)
      return false;
    if (!text) return true;
    if (!this.attached) {
      if (this.pendingInput.length + text.length > PENDING_INPUT_MAX) {
        this.notifyError(
          new Error(
            "Terminal is still starting; wait before pasting this text.",
          ),
        );
        return false;
      }
      this.pendingInput += text;
    } else this.enqueue(text);
    return true;
  }

  resize(cols: number, rows: number): void {
    if (this.closed || this.firstFailure) return;
    if (cols === this.size.cols && rows === this.size.rows) return;
    this.size = { cols, rows };
    this.synchronizeSize();
  }

  async layoutSettled(): Promise<void> {
    while (this.layout) await this.layout;
  }

  private needsResize(): boolean {
    return (
      !this.closed &&
      !this.firstFailure &&
      this.engine !== null &&
      (this.appliedSize.cols !== this.size.cols ||
        this.appliedSize.rows !== this.size.rows)
    );
  }

  private synchronizeSize(): void {
    if (this.layout || !this.needsResize()) return;
    this.layout = Promise.resolve()
      .then(async () => {
        while (this.needsResize()) {
          const next = { ...this.size };
          await this.engine?.resize(next.cols, next.rows);
          this.appliedSize = next;
        }
      })
      .catch(this.fail)
      .finally(() => {
        this.layout = null;
        this.synchronizeSize();
      });
  }

  settled(): Promise<void> {
    return this.writes;
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    this.pendingInput = "";
    this.engine = null;
    this.closing = this.acquisition.then(
      (engine) => this.retire(engine),
      () => {},
    );
    return this.closing;
  }

  private retire(engine: TerminalEngine): Promise<void> {
    if (!this.retirement) {
      this.retirement = Promise.resolve()
        .then(() => engine.close())
        .catch((error: unknown) => {
          const failure =
            error instanceof Error ? error : new Error(String(error));
          this.notifyError(failure);
          throw failure;
        });
    }
    return this.retirement;
  }

  private enqueue(text: string): void {
    this.writes = this.writes
      .then(async () => {
        if (this.closed || this.firstFailure || this.firstExit !== null) return;
        await this.engine?.write(text);
      })
      .catch(this.fail);
  }

  private readonly fail = (error: unknown): void => {
    if (this.closed || this.firstFailure) return;
    this.firstFailure =
      error instanceof Error ? error : new Error(String(error));
    this.pendingInput = "";
    this.notifyError(this.firstFailure);
    this.engine = null;
    if (this.acquiredEngine)
      void this.retire(this.acquiredEngine).catch(() => {});
  };

  private readonly exit = (code: number): void => {
    if (this.closed || this.firstExit !== null) return;
    this.firstExit = code;
    this.pendingInput = "";
    try {
      this.observer.onExit?.(code);
    } catch {
      console.error("terminal exit observer failed");
    }
  };

  private notifyError(error: Error): void {
    try {
      this.observer.onError?.(error);
    } catch {
      console.error("terminal error observer failed");
    }
  }
}
