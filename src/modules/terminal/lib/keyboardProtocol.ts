// Tracks the terminal keyboard-encoding modes a foreground program negotiates
// through its output stream, so key events Terax synthesizes match what the
// program expects to read back.
//
// xterm.js implements neither the Kitty keyboard protocol nor xterm's
// modifyOtherKeys, so Terax must observe the negotiation itself. pi-tui (Pi's
// TUI layer) probes with `CSI > 7 u ; CSI ? u ; CSI c`; since we never answer
// the Kitty flags query it falls back to modifyOtherKeys and enables it with
// XTMODKEYS `CSI > 4 ; Pv m`. Once that is active it expects the otherwise
// ambiguous Shift+Enter as `CSI 27 ; 2 ; 13 ~` rather than a bare `ESC CR`.
//
// We deliberately do NOT advertise Kitty support: doing so would obligate us to
// encode every key as CSI-u, which xterm.js does not do. modifyOtherKeys is a
// self-contained, opt-in upgrade that only changes the keys we choose to honor.

const ESC = 0x1b;
const LBRACKET = 0x5b; // [
const GT = 0x3e; // >
const SEMI = 0x3b; // ;
const M = 0x6d; // m
const DIGIT_0 = 0x30;
const DIGIT_9 = 0x39;

// XTMODKEYS resource selecting modifyOtherKeys.
const RESOURCE_MODIFY_OTHER_KEYS = 4;

// Bounds the carry buffer and per-field digit runs so a hostile or malformed
// stream can never make the tracker retain or scan unbounded state.
const MAX_DIGITS = 6;
const MAX_CARRY = 24;

const isDigit = (b: number) => b >= DIGIT_0 && b <= DIGIT_9;

type ScanResult =
  | { kind: "match"; resource: number; value: number | null; next: number }
  | { kind: "incomplete" }
  | { kind: "none" };

// Attempts to read one `CSI > Pp (; Pv)? m` (XTMODKEYS) sequence starting at the
// ESC byte at `start`. Returns "incomplete" only when the bytes so far are a
// strict prefix of that grammar, so the caller can safely carry them.
function scanXtmodkeys(
  data: Uint8Array,
  start: number,
  len: number,
): ScanResult {
  let i = start + 1;
  if (i >= len) return { kind: "incomplete" };
  if (data[i] !== LBRACKET) return { kind: "none" };

  i++;
  if (i >= len) return { kind: "incomplete" };
  if (data[i] !== GT) return { kind: "none" };

  i++;
  let resource = 0;
  let resourceDigits = 0;
  while (i < len && isDigit(data[i])) {
    resource = resource * 10 + (data[i] - DIGIT_0);
    if (++resourceDigits > MAX_DIGITS) return { kind: "none" };
    i++;
  }
  if (resourceDigits === 0) {
    // Either not yet arrived, or a `>` sequence with no numeric parameter.
    return i >= len ? { kind: "incomplete" } : { kind: "none" };
  }
  if (i >= len) return { kind: "incomplete" };

  if (data[i] === M) {
    return { kind: "match", resource, value: null, next: i + 1 };
  }
  if (data[i] !== SEMI) return { kind: "none" };

  i++;
  let value = 0;
  let valueDigits = 0;
  while (i < len && isDigit(data[i])) {
    value = value * 10 + (data[i] - DIGIT_0);
    if (++valueDigits > MAX_DIGITS) return { kind: "none" };
    i++;
  }
  if (i >= len) return { kind: "incomplete" };
  if (data[i] !== M || valueDigits === 0) return { kind: "none" };
  return { kind: "match", resource, value, next: i + 1 };
}

export class KeyboardProtocolTracker {
  private level = 0;
  private carry: Uint8Array | null = null;

  /** modifyOtherKeys level the foreground program requested (0 = off). */
  get modifyOtherKeys(): number {
    return this.level;
  }

  /**
   * Feed a chunk of raw PTY output. Cheap on the hot path: chunks with no ESC
   * and no pending carry are skipped after a single linear scan, and each ESC
   * that is not our sequence bails within a few bytes.
   */
  ingest(bytes: Uint8Array): void {
    let data = bytes;
    if (this.carry) {
      const merged = new Uint8Array(this.carry.length + bytes.length);
      merged.set(this.carry);
      merged.set(bytes, this.carry.length);
      data = merged;
      this.carry = null;
    }

    const len = data.length;
    for (let i = 0; i < len; i++) {
      if (data[i] !== ESC) continue;
      const r = scanXtmodkeys(data, i, len);
      if (r.kind === "incomplete") {
        const tail = data.subarray(i, len);
        if (tail.length <= MAX_CARRY) this.carry = tail.slice();
        return;
      }
      if (r.kind === "match") {
        if (r.resource === RESOURCE_MODIFY_OTHER_KEYS) {
          this.level = r.value ?? 0;
        }
        i = r.next - 1;
      }
    }
  }
}

/**
 * The byte sequence Terax must send for Shift+Enter given the active
 * modifyOtherKeys level. Level >= 1 uses the unambiguous xterm encoding that
 * pi-tui and other TUIs read as Shift+Enter; otherwise we keep the legacy
 * `ESC CR` so plain shells behave exactly as before.
 */
export function shiftEnterSequence(modifyOtherKeysLevel: number): string {
  return modifyOtherKeysLevel >= 1 ? "\x1b[27;2;13~" : "\x1b\r";
}
