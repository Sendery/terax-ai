export class ShellSubmission {
  private pending: symbol | null = null;
  invalidate(): void {
    this.pending = null;
  }
  run(
    send: () => void | Promise<void>,
    accepted: () => void,
    failed: (error: unknown) => void,
  ): void {
    if (this.pending) return;
    const token = Symbol();
    this.pending = token;
    const reject = (error: unknown) => {
      if (this.pending !== token) return;
      this.pending = null;
      try {
        failed(error);
      } catch {
        console.error("shell submission error observer failed");
      }
    };
    const complete = () => {
      if (this.pending !== token) return;
      this.pending = null;
      try {
        accepted();
      } catch (error) {
        try {
          failed(error);
        } catch {
          console.error("shell submission error observer failed");
        }
      }
    };
    try {
      const result = send();
      if (result) void result.then(complete, reject);
      else complete();
    } catch (error) {
      reject(error);
    }
  }
}
