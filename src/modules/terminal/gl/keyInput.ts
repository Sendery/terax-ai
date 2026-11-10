// Phase 1 keyboard: just enough to drive a shell. The full encoder (Kitty
// protocol, application cursor mode, modifyOtherKeys) moves into Rust later.

export type KeyInput = {
  key: string;
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  isComposing: boolean;
};

const ESC = "\x1b";

const CURSOR_KEYS: Record<string, string> = {
  ArrowUp: "A",
  ArrowDown: "B",
  ArrowRight: "C",
  ArrowLeft: "D",
  Home: "H",
  End: "F",
};

const TILDE_KEYS: Record<string, number> = {
  Insert: 2,
  Delete: 3,
  PageUp: 5,
  PageDown: 6,
};

function modifierParam(e: KeyInput): number {
  return 1 + (e.shiftKey ? 1 : 0) + (e.altKey ? 2 : 0) + (e.ctrlKey ? 4 : 0);
}

function controlByte(key: string): string | null {
  if (key.length !== 1) return null;
  const c = key.toLowerCase().charCodeAt(0);
  if (c >= 97 && c <= 122) return String.fromCharCode(c - 96);
  switch (key) {
    case " ":
    case "@":
    case "2":
      return "\x00";
    case "[":
    case "3":
      return ESC;
    case "\\":
    case "4":
      return "\x1c";
    case "]":
    case "5":
      return "\x1d";
    case "^":
    case "6":
      return "\x1e";
    case "_":
    case "-":
    case "7":
      return "\x1f";
    case "?":
    case "8":
      return "\x7f";
    default:
      return null;
  }
}

/**
 * The key Alt applies to. macOS Option composes another character (Option+f
 * is "ƒ"), so a non-ASCII key falls back to the physical key's letter;
 * ASCII keys are kept so other layouts map as typed.
 */
function altBase(e: KeyInput): string {
  if (/^[\x20-\x7e]$/.test(e.key)) return e.key;
  const letter = /^Key([A-Z])$/.exec(e.code);
  if (letter) return e.shiftKey ? letter[1] : letter[1].toLowerCase();
  const digit = /^Digit([0-9])$/.exec(e.code);
  if (digit && !e.shiftKey) return digit[1];
  return e.key;
}

/**
 * Bytes for a key press, or null when the key is not the terminal's: printable
 * text without modifiers is left to the hidden textarea so dead keys and IME
 * composition work, and Cmd chords belong to the app (paste, copy, menus).
 */
export function encodeKey(e: KeyInput): string | null {
  if (e.isComposing || e.key === "Process" || e.key === "Dead") return null;
  if (e.metaKey) return null;

  const cursor = CURSOR_KEYS[e.key];
  if (cursor) {
    const mod = modifierParam(e);
    return mod === 1 ? `${ESC}[${cursor}` : `${ESC}[1;${mod}${cursor}`;
  }
  const tilde = TILDE_KEYS[e.key];
  if (tilde !== undefined) {
    const mod = modifierParam(e);
    return mod === 1 ? `${ESC}[${tilde}~` : `${ESC}[${tilde};${mod}~`;
  }

  const meta = e.altKey ? ESC : "";
  switch (e.key) {
    case "Enter":
      return `${meta}\r`;
    case "Backspace":
      return e.ctrlKey ? `${meta}\x08` : `${meta}\x7f`;
    case "Tab":
      return e.shiftKey ? `${ESC}[Z` : `${meta}\t`;
    case "Escape":
      return `${meta}${ESC}`;
  }

  if (e.ctrlKey) {
    const base = e.altKey ? altBase(e) : e.key;
    const byte = controlByte(base);
    return byte === null ? null : `${meta}${byte}`;
  }
  if (e.altKey) {
    const base = altBase(e);
    return [...base].length === 1 ? `${ESC}${base}` : null;
  }
  return null;
}

/** Pasted text as a terminal expects it: newlines become carriage returns. */
export function encodePaste(text: string): string {
  return text.replace(/\r?\n/g, "\r");
}

/** Whole rows a wheel delta scrolls, carrying the remainder in pixels. */
export function wheelRows(
  carry: number,
  deltaY: number,
  deltaMode: number,
  rowHeightPx: number,
  pageRows: number,
): { rows: number; carry: number } {
  if (deltaMode === 1) return { rows: Math.trunc(deltaY), carry: 0 };
  if (deltaMode === 2) return { rows: Math.trunc(deltaY) * pageRows, carry: 0 };
  if (rowHeightPx <= 0) return { rows: 0, carry: 0 };
  const total = carry + deltaY;
  const rows = Math.trunc(total / rowHeightPx) || 0;
  return { rows, carry: total - rows * rowHeightPx };
}

/** Grid that fits a box, never smaller than 2x1. */
export function gridFor(
  width: number,
  height: number,
  cell: { width: number; height: number },
): { cols: number; rows: number } {
  if (cell.width <= 0 || cell.height <= 0) return { cols: 2, rows: 1 };
  return {
    cols: Math.max(2, Math.floor(width / cell.width)),
    rows: Math.max(1, Math.floor(height / cell.height)),
  };
}
