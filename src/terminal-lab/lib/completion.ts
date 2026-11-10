/** The PTY exit channel can overtake its final data messages and xterm's write queue. */
export class PayloadCompletion {
  readonly done: Promise<void>;
  private resolve = () => {};
  private reject = (_error: Error) => {};
  private exitCode: number | null = null;
  private drained = false;
  private drawn = false;
  private settled = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly expected: number,
    private readonly received: () => number,
    private readonly drainMs = 180_000,
  ) {
    this.done = new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
    void this.done.catch(() => {});
  }

  exit(code: number): void {
    if (this.settled) return;
    this.exitCode = code;
    if (code !== 0) {
      this.finish(new Error(`xterm fixture exited ${code}`));
      return;
    }
    if (!this.timer)
      this.timer = setTimeout(
        () =>
          this.finish(
            new Error(
              `xterm post-exit drain timed out: ${this.received()}/${this.expected} bytes, drained=${this.drained}, drawn=${this.drawn}`,
            ),
          ),
        this.drainMs,
      );
    this.check();
  }

  parsed(): void {
    this.drained = this.received() === this.expected;
    this.check();
  }
  rendered(): void {
    if (this.drained) this.drawn = true;
    this.check();
  }
  dispose(): void {
    this.finish(new Error("xterm benchmark closed"));
  }

  private check(): void {
    if (
      this.exitCode === 0 &&
      this.received() === this.expected &&
      this.drained &&
      this.drawn
    )
      this.finish();
  }

  private finish(error?: Error): void {
    if (this.settled) return;
    this.settled = true;
    if (this.timer) clearTimeout(this.timer);
    if (error) this.reject(error);
    else this.resolve();
  }
}
