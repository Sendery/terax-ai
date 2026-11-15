const MAX_CLIPBOARD_BYTES = 1024 * 1024;
const encoder = new TextEncoder();

export function nativeClipboardText(value: unknown): string | null {
  if (value === null) return null;
  if (
    typeof value !== "string" ||
    value.length > MAX_CLIPBOARD_BYTES ||
    encoder.encode(value).byteLength > MAX_CLIPBOARD_BYTES
  )
    throw new Error("Invalid terminal clipboard write");
  return value;
}

export class NativeClipboardRelay {
  private pending = false;
  private draining = false;
  private closed = false;
  constructor(
    private readonly options: {
      current: () => boolean;
      take: () => Promise<unknown>;
      write: (text: string) => Promise<void>;
    },
  ) {}

  notify(): void {
    if (this.closed) return;
    this.pending = true;
    this.resume();
  }
  resume(): void {
    void this.drain();
  }
  close(): void {
    this.closed = true;
    this.pending = false;
  }

  private async drain(): Promise<void> {
    if (this.draining || this.closed || !this.options.current()) return;
    this.draining = true;
    try {
      while (this.pending && !this.closed && this.options.current()) {
        this.pending = false;
        try {
          const value = await this.options.take();
          if (this.closed || !this.options.current()) return;
          const text = nativeClipboardText(value);
          if (text !== null) await this.options.write(text);
        } catch {}
      }
    } finally {
      this.draining = false;
    }
  }
}
