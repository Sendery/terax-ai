/** Keeps a leaf's next process behind confirmed retirement of its predecessor. */
export class TerminalRetirement {
  private pending: Promise<void> = Promise.resolve();
  beforeOpen(): Promise<void> {
    return this.pending;
  }
  track(closing: Promise<void>): Promise<void> {
    this.pending = Promise.all([this.pending, closing]).then(() => {});
    return this.pending;
  }
}
