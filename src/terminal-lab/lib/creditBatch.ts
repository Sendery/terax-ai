export type CreditAck = { id: number; seq: number };
type Pending = CreditAck & {
  queuedAt: number;
  drawnAt: number;
  onDispatch?: (at: number) => void;
  resolve: () => void;
  reject: (error: Error) => void;
};

export class LabCreditBatcher {
  private queue: Pending[] = [];
  private pending = new Set<Pending>();
  private scheduled = false;
  private closed = false;
  private queued = 0;
  private registered = 0;
  private failed = 0;
  private rejected = 0;
  private invocations = 0;
  private maxPending = 0;
  private sizes = Array<number>(13).fill(0);
  private delay = { count: 0, total: 0, min: Infinity, max: 0 };
  private drawDelay = { count: 0, total: 0, min: Infinity, max: 0 };

  constructor(
    private readonly invoke: (acks: CreditAck[]) => Promise<void>,
    private readonly schedule: (task: () => void) => void = (task) =>
      globalThis.queueMicrotask(task),
    private readonly now: () => number = () => performance.now(),
  ) {}

  send = (
    id: number,
    seq: number,
    drawnAt?: number,
    onDispatch?: (at: number) => void,
  ): Promise<void> => {
    const queuedAt = this.now();
    const drawn = drawnAt ?? queuedAt;
    let reason: string | null = null;
    if (this.closed) reason = "credit batcher closed";
    else if (
      ![id, seq].every(
        (value) => Number.isInteger(value) && value > 0 && value <= 0xffffffff,
      )
    )
      reason = "credit id and sequence must be positive u32";
    else if (!Number.isFinite(drawn) || drawn < 0 || drawn > queuedAt)
      reason = "invalid draw timestamp";
    else if (this.pending.size >= 48)
      reason = "credit batcher exceeds 48 pending acknowledgements";
    else if ([...this.pending].some((ack) => ack.id === id && ack.seq === seq))
      reason = "duplicate outstanding credit pair";
    if (reason) {
      this.rejected += 1;
      return Promise.reject(new Error(reason));
    }
    return new Promise<void>((resolve, reject) => {
      const ack = {
        id,
        seq,
        queuedAt,
        drawnAt: drawn,
        onDispatch,
        resolve,
        reject,
      };
      this.queue.push(ack);
      this.pending.add(ack);
      this.queued += 1;
      this.maxPending = Math.max(this.maxPending, this.pending.size);
      if (!this.scheduled) {
        this.scheduled = true;
        try {
          this.schedule(this.flush);
        } catch (error) {
          this.stop(error instanceof Error ? error : new Error(String(error)));
        }
      }
    });
  };

  private flush = (): void => {
    this.scheduled = false;
    if (this.closed) return;
    while (this.queue.length > 0) {
      const ids = new Set<number>();
      const batch: Pending[] = [];
      while (this.queue.length > 0 && batch.length < 12) {
        const ack = this.queue[0];
        if (ids.has(ack.id)) break;
        ids.add(ack.id);
        batch.push(ack);
        this.queue.shift();
      }
      this.dispatch(batch);
    }
  };

  private dispatch(batch: Pending[]): void {
    const at = this.now();
    const finish = (ok: boolean, error?: unknown) => {
      for (const ack of batch) {
        if (!this.pending.delete(ack)) continue;
        if (!ok) {
          this.failed += 1;
          ack.reject(error instanceof Error ? error : new Error(String(error)));
        } else {
          this.registered += 1;
          ack.resolve();
        }
      }
    };
    try {
      for (const ack of batch) ack.onDispatch?.(at);
      this.invocations += 1;
      this.sizes[batch.length] += 1;
      for (const ack of batch) {
        const delay = at - ack.queuedAt;
        this.delay.count += 1;
        this.delay.total += delay;
        this.delay.min = Math.min(this.delay.min, delay);
        this.delay.max = Math.max(this.delay.max, delay);
        const drawDelay = at - ack.drawnAt;
        this.drawDelay.count += 1;
        this.drawDelay.total += drawDelay;
        this.drawDelay.min = Math.min(this.drawDelay.min, drawDelay);
        this.drawDelay.max = Math.max(this.drawDelay.max, drawDelay);
      }
      this.invoke(batch.map(({ id, seq }) => ({ id, seq }))).then(
        () => finish(true),
        (error) => finish(false, error),
      );
    } catch (error) {
      finish(false, error);
    }
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  snapshot() {
    return {
      mode: "window-microtask" as const,
      queued: this.queued,
      registered: this.registered,
      failed: this.failed,
      rejected: this.rejected,
      pending: this.pending.size,
      maxPending: this.maxPending,
      invocations: this.invocations,
      sizes: [...this.sizes],
      dispatchDelayMs: {
        ...this.delay,
        min: this.delay.count ? this.delay.min : null,
      },
      drawToDispatchMs: {
        ...this.drawDelay,
        min: this.drawDelay.count ? this.drawDelay.min : null,
      },
      complete:
        this.pending.size === 0 &&
        this.failed === 0 &&
        this.rejected === 0 &&
        this.registered === this.queued,
    };
  }

  private stop(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    this.scheduled = false;
    this.queue = [];
    for (const ack of this.pending) {
      this.failed += 1;
      ack.reject(error);
    }
    this.pending.clear();
  }

  close(): void {
    this.stop(new Error("credit batcher closed"));
  }
}
