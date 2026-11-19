/** What a key does in a focused Reader. Kept apart from the DOM so the map is tested. */
export type ReaderAction =
  | { type: "toggle" }
  | { type: "segment"; delta: 1 | -1 }
  | { type: "skipMs"; deltaMs: number }
  | { type: "scroll"; lines: number }
  | { type: "page"; direction: 1 | -1 }
  | { type: "cursorWord"; delta: 1 | -1 }
  | { type: "cursorBlock"; delta: 1 | -1 }
  | { type: "playCursor" }
  | { type: "center" }
  | { type: "cut"; kind: "bookmark" | "pause" | "stop" }
  | { type: "jumpCut"; direction: 1 | -1 }
  | { type: "speed"; direction: 1 | -1 }
  | { type: "float" }
  | { type: "export" }
  | { type: "quit" }
  | { type: "escape" };

export type KeyLike = {
  key: string;
  shiftKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
};

export const SKIP_MS = 10_000;

export function readerKeyAction(event: KeyLike): ReaderAction | null {
  // Chords belong to the app (tab switching, palette, copy).
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  switch (event.key) {
    case " ":
      return { type: "toggle" };
    case "ArrowLeft":
      return event.shiftKey
        ? { type: "skipMs", deltaMs: -SKIP_MS }
        : { type: "segment", delta: -1 };
    case "ArrowRight":
      return event.shiftKey
        ? { type: "skipMs", deltaMs: SKIP_MS }
        : { type: "segment", delta: 1 };
    case "ArrowUp":
    case "k":
      return { type: "scroll", lines: -3 };
    case "ArrowDown":
    case "j":
      return { type: "scroll", lines: 3 };
    case "PageUp":
      return { type: "page", direction: -1 };
    case "PageDown":
      return { type: "page", direction: 1 };
    case "w":
      return { type: "cursorWord", delta: 1 };
    case "b":
      return { type: "cursorWord", delta: -1 };
    case "}":
      return { type: "cursorBlock", delta: 1 };
    case "{":
      return { type: "cursorBlock", delta: -1 };
    case "Enter":
      return { type: "playCursor" };
    case "c":
      return { type: "center" };
    case "m":
      return { type: "cut", kind: "bookmark" };
    case "p":
      return { type: "cut", kind: "pause" };
    case "P":
      return { type: "cut", kind: "stop" };
    case "]":
      return { type: "jumpCut", direction: 1 };
    case "Tab":
      return { type: "jumpCut", direction: event.shiftKey ? -1 : 1 };
    case "[":
      return { type: "jumpCut", direction: -1 };
    case "+":
    case "=":
      return { type: "speed", direction: 1 };
    case "-":
    case "_":
      return { type: "speed", direction: -1 };
    case "f":
      return { type: "float" };
    case "e":
      return { type: "export" };
    case "q":
      return { type: "quit" };
    case "Escape":
      return { type: "escape" };
    default:
      return null;
  }
}

/** The help strip, in the order the keys are listed in docs/reader.md. */
export const READER_KEY_HELP: readonly { keys: string; label: string }[] = [
  { keys: "Space", label: "Play / pause" },
  { keys: "Click", label: "Read from a word" },
  { keys: "← →", label: "Previous / next sentence" },
  { keys: "⇧← ⇧→", label: "Back / forward 10s" },
  { keys: "j k ↑ ↓", label: "Scroll freely" },
  { keys: "w b { }", label: "Move the cursor by word / paragraph" },
  { keys: "Enter", label: "Read from the cursor" },
  { keys: "c", label: "Back to the reading point" },
  { keys: "m", label: "Bookmark" },
  { keys: "p / P", label: "Scripted pause / stop" },
  { keys: "[ ] Tab", label: "Previous / next cut" },
  { keys: "+ -", label: "Speed" },
  { keys: "f", label: "Floating controls" },
  { keys: "e", label: "Export audio" },
  { keys: "q", label: "Save and close" },
];
