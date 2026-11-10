export const PAYLOAD_START = "\x1b]777;terax-lab-payload\x07";

/** Remove shell startup/echo bytes and retain exactly the fixture's byte count. */
export class PayloadWindow {
  received = 0;
  private prefix = new Uint8Array(0);
  private started = false;
  private readonly marker = new TextEncoder().encode(PAYLOAD_START);

  constructor(readonly expected: number) {}

  push(bytes: Uint8Array): Uint8Array {
    if (!this.started) {
      const joined = new Uint8Array(this.prefix.length + bytes.length);
      joined.set(this.prefix);
      joined.set(bytes, this.prefix.length);
      let at = -1;
      for (let i = 0; i <= joined.length - this.marker.length; i++) {
        if (this.marker.every((value, j) => joined[i + j] === value)) {
          at = i;
          break;
        }
      }
      if (at < 0) {
        this.prefix = joined.slice(
          -Math.min(joined.length, this.marker.length - 1),
        );
        return new Uint8Array(0);
      }
      this.started = true;
      this.prefix = new Uint8Array(0);
      bytes = joined.subarray(at + this.marker.length);
    }
    const payload = bytes.subarray(
      0,
      Math.max(0, this.expected - this.received),
    );
    this.received += payload.length;
    return payload;
  }
}
