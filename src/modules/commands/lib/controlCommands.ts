import { checkShellCommand } from "@/modules/ai/lib/security";
import { CHAT_LAYOUT_MODES, type ChatLayoutMode } from "@/modules/ai/lib/chatLayout";
import { WATCH_ACTIONS, type WatchAction } from "@/modules/watchers/lib/watch";
import type { CommandParamSchema } from "./registry";

/**
 * Commands that let an agent operate the workspace rather than only arrange
 * it: terminal panes (list, read, open, split, focus, close, type), spaces,
 * and watches (a shell command polled on an interval that reports when its
 * output changes).
 *
 * They are declared as data: one param table drives the catalog, the MCP
 * surface and the validator, so a new command of this kind is one entry here
 * plus a handler, never a hand-written validator.
 */
export const CONTROL_COMMAND_IDS = [
  "terminal.list",
  "terminal.read",
  "terminal.open",
  "terminal.split",
  "terminal.focus",
  "terminal.close",
  "terminal.send",
  "space.list",
  "space.focus",
  "tab.moveToSpace",
  "watch.list",
  "watch.read",
  "watch.add",
  "watch.update",
  "watch.remove",
  "watch.setEnabled",
  "watch.run",
  "chat.layout",
  "reader.open",
  "reader.list",
  "reader.state",
  "reader.control",
  "reader.mark",
  "reader.export",
] as const;

export type ControlCommandId = (typeof CONTROL_COMMAND_IDS)[number];

export const SPLIT_DIRECTIONS = ["right", "down"] as const;
export type SplitDirection = (typeof SPLIT_DIRECTIONS)[number];


export const TERMINAL_READ_DEFAULT_LINES = 200;
export const TERMINAL_READ_MAX_LINES = 2000;
export const TERMINAL_SEND_MAX_CHARS = 4000;
export const WATCH_MIN_INTERVAL_SECONDS = 15;
export const WATCH_MAX_INTERVAL_SECONDS = 86_400;
export const WATCH_COMMAND_MAX_CHARS = 2000;
export const WATCH_PROMPT_MAX_CHARS = 4000;
/** Bridge frames cap at 384 KiB; longer texts go through a file path. */
export const READER_TEXT_MAX_CHARS = 300_000;
export const READER_CONTROL_ACTIONS = [
  "play",
  "pause",
  "toggle",
  "stop",
  "next",
  "previous",
  "seek",
] as const;
export type ReaderControlAction = (typeof READER_CONTROL_ACTIONS)[number];
export const READER_CUT_KINDS = ["bookmark", "pause", "stop"] as const;

export type WatchFields = {
  cwd?: string;
  onChange?: WatchAction;
  prompt?: string;
};

export type ControlPayloads = {
  "terminal.list": undefined;
  "terminal.read": { leafId: number; lines?: number };
  "terminal.open": { cwd?: string; command?: string; title?: string };
  "terminal.split": {
    leafId: number;
    direction: SplitDirection;
    command?: string;
  };
  "terminal.focus": { leafId: number };
  "terminal.close": { leafId: number };
  "terminal.send": { leafId: number; text: string; submit?: boolean };
  "space.list": undefined;
  "space.focus": { spaceId: string };
  "tab.moveToSpace": { tabId: number; spaceId: string };
  "watch.list": undefined;
  "watch.read": { id: string };
  "watch.add": WatchFields & {
    name: string;
    command: string;
    intervalSeconds: number;
  };
  "watch.update": WatchFields & {
    id: string;
    name?: string;
    command?: string;
    intervalSeconds?: number;
  };
  "watch.remove": { id: string };
  "watch.setEnabled": { id: string; enabled: boolean };
  "watch.run": { id: string };
  "chat.layout": { mode: ChatLayoutMode; show?: boolean };
  "reader.open": {
    text?: string;
    path?: string;
    title?: string;
    play?: boolean;
    /** Set by `terax --read` when `path` is a temporary copy of stdin. */
    stdin?: boolean;
  };
  "reader.list": undefined;
  "reader.state": { docId?: string };
  "reader.control": {
    op: ReaderControlAction;
    docId?: string;
    wordIndex?: number;
    positionMs?: number;
    speedPercent?: number;
  };
  "reader.mark": {
    wordIndex: number;
    kind: (typeof READER_CUT_KINDS)[number];
    docId?: string;
    label?: string;
    pauseMs?: number;
    remove?: boolean;
  };
  "reader.export": { docId?: string };
};

type Reply = Promise<unknown> | unknown;

export type ControlHandlers = {
  listTerminals: () => Reply;
  readTerminal: (payload: ControlPayloads["terminal.read"]) => Reply;
  openTerminal: (payload: ControlPayloads["terminal.open"]) => Reply;
  splitTerminal: (payload: ControlPayloads["terminal.split"]) => Reply;
  focusTerminal: (payload: ControlPayloads["terminal.focus"]) => Reply;
  closeTerminal: (payload: ControlPayloads["terminal.close"]) => Reply;
  sendToTerminal: (payload: ControlPayloads["terminal.send"]) => Reply;
  listSpaces: () => Reply;
  focusSpace: (payload: ControlPayloads["space.focus"]) => Reply;
  moveTabToSpace: (payload: ControlPayloads["tab.moveToSpace"]) => Reply;
  listWatches: () => Reply;
  readWatch: (payload: ControlPayloads["watch.read"]) => Reply;
  addWatch: (payload: ControlPayloads["watch.add"]) => Reply;
  updateWatch: (payload: ControlPayloads["watch.update"]) => Reply;
  removeWatch: (payload: ControlPayloads["watch.remove"]) => Reply;
  setWatchEnabled: (payload: ControlPayloads["watch.setEnabled"]) => Reply;
  runWatch: (payload: ControlPayloads["watch.run"]) => Reply;
  setChatLayout: (payload: ControlPayloads["chat.layout"]) => Reply;
  openReader: (payload: ControlPayloads["reader.open"]) => Reply;
  listReader: () => Reply;
  readerState: (payload: ControlPayloads["reader.state"]) => Reply;
  controlReader: (payload: ControlPayloads["reader.control"]) => Reply;
  markReader: (payload: ControlPayloads["reader.mark"]) => Reply;
  exportReader: (payload: ControlPayloads["reader.export"]) => Reply;
};

/** Limits the validator enforces on top of the public param shape. */
type ControlParam = CommandParamSchema & {
  min?: number;
  max?: number;
  maxLength?: number;
  /** Runs through a shell: single line, deny-listed forms refused. */
  shell?: boolean;
  /** Typed into a terminal: no control bytes. */
  typed?: boolean;
  /** At least one non-space character. */
  nonEmpty?: boolean;
};

type ControlSpec = {
  description: string;
  params: readonly ControlParam[];
  /** Fields a call must carry at least one of, beyond the required ones. */
  anyOf?: readonly string[];
};

const READER_DOC_ID: ControlParam = {
  name: "docId",
  type: "string",
  required: false,
  description: "Reader document id, from reader.list or the snapshot's reader tabs.",
  maxLength: 12,
  nonEmpty: true,
};

const LEAF_ID: ControlParam = {
  name: "leafId",
  type: "integer",
  required: true,
  description: "Id of the terminal pane, from terminal.list.",
  min: 0,
};

const WATCH_ID: ControlParam = {
  name: "id",
  type: "string",
  required: true,
  description: "Id of the watch, from watch.list.",
  nonEmpty: true,
  maxLength: 64,
};

const SHELL_COMMAND_NOTE =
  "One line, run by the user's login shell. Destructive forms are refused.";

function watchParams(required: boolean): ControlParam[] {
  return [
    {
      name: "name",
      type: "string",
      required,
      description: "Short label shown in the watch list and in notifications.",
      nonEmpty: true,
      maxLength: 80,
    },
    {
      name: "command",
      type: "string",
      required,
      description: `Command whose output is compared between runs, for example gh pr view 42 --json state,reviewDecision,statusCheckRollup. ${SHELL_COMMAND_NOTE}`,
      shell: true,
      maxLength: WATCH_COMMAND_MAX_CHARS,
    },
    {
      name: "intervalSeconds",
      type: "integer",
      required,
      description: `Seconds between runs, ${WATCH_MIN_INTERVAL_SECONDS} to ${WATCH_MAX_INTERVAL_SECONDS}.`,
      min: WATCH_MIN_INTERVAL_SECONDS,
      max: WATCH_MAX_INTERVAL_SECONDS,
    },
    {
      name: "cwd",
      type: "string",
      required: false,
      description:
        "Directory the command runs in. Defaults to the active terminal's directory.",
      maxLength: 4096,
    },
    {
      name: "onChange",
      type: "enum",
      required: false,
      description:
        "What happens when the output changes: notify posts a notification, agent hands the new output and the prompt to the Terax AI chat so it can update panels, graphs or notes, none only records it. Defaults to notify.",
      values: [...WATCH_ACTIONS],
    },
    {
      name: "prompt",
      type: "string",
      required: false,
      description:
        "With onChange agent: what the agent should do with the new output, for example update the GraphX document pr-radar.",
      maxLength: WATCH_PROMPT_MAX_CHARS,
    },
  ];
}

const CONTROL_SPECS: Record<ControlCommandId, ControlSpec> = {
  "terminal.list": {
    description:
      "List every terminal pane that is not private: pane id, tab, space, title, directory, whether it has focus and which coding agent runs in it. Private terminals are counted, never described.",
    params: [],
  },
  "terminal.read": {
    description:
      "Read the tail of a terminal pane's scrollback with secrets redacted. Refused for private terminals and for panes restored from disk that have not been opened yet.",
    params: [
      LEAF_ID,
      {
        name: "lines",
        type: "integer",
        required: false,
        description: `Trailing lines to return, 1 to ${TERMINAL_READ_MAX_LINES}. Defaults to ${TERMINAL_READ_DEFAULT_LINES}.`,
        min: 1,
        max: TERMINAL_READ_MAX_LINES,
      },
    ],
  },
  "terminal.open": {
    description:
      "Open a new terminal tab in the active space and focus it, optionally running a command in it once the shell is ready.",
    params: [
      {
        name: "cwd",
        type: "string",
        required: false,
        description:
          "Directory the shell starts in. Defaults to the active terminal's directory.",
        maxLength: 4096,
      },
      {
        name: "command",
        type: "string",
        required: false,
        description: `Command typed and submitted in the new terminal. ${SHELL_COMMAND_NOTE}`,
        shell: true,
        maxLength: TERMINAL_SEND_MAX_CHARS,
      },
      {
        name: "title",
        type: "string",
        required: false,
        description: "Custom tab title.",
        nonEmpty: true,
        maxLength: 80,
      },
    ],
  },
  "terminal.split": {
    description:
      "Split a terminal pane and focus the new one, optionally running a command in it. A tab holds at most four panes.",
    params: [
      LEAF_ID,
      {
        name: "direction",
        type: "enum",
        required: true,
        description: "Where the new pane goes relative to the split one.",
        values: [...SPLIT_DIRECTIONS],
      },
      {
        name: "command",
        type: "string",
        required: false,
        description: `Command typed and submitted in the new pane. ${SHELL_COMMAND_NOTE}`,
        shell: true,
        maxLength: TERMINAL_SEND_MAX_CHARS,
      },
    ],
  },
  "terminal.focus": {
    description: "Focus a terminal pane, switching space and tab as needed.",
    params: [LEAF_ID],
  },
  "terminal.close": {
    description:
      "Close a terminal pane and end its shell. Closing the last pane of a tab closes the tab.",
    params: [LEAF_ID],
  },
  "terminal.send": {
    description:
      "Type text into a terminal pane, as if the user had. It runs whatever is at the prompt: a shell command, or an answer to the program in the foreground. Refused for private terminals.",
    params: [
      LEAF_ID,
      {
        name: "text",
        type: "string",
        required: true,
        description: `Text to type, one line, ${TERMINAL_SEND_MAX_CHARS} characters at most.`,
        typed: true,
        nonEmpty: true,
        maxLength: TERMINAL_SEND_MAX_CHARS,
      },
      {
        name: "submit",
        type: "boolean",
        required: false,
        description:
          "Press Enter after the text. Defaults to true; false leaves it at the prompt for the user.",
      },
    ],
  },
  "space.list": {
    description:
      "List the spaces (named groups of tabs): id, name, root directory, tab count and which one is active.",
    params: [],
  },
  "space.focus": {
    description: "Switch to a space.",
    params: [
      {
        name: "spaceId",
        type: "string",
        required: true,
        description: "Id of the space, from space.list.",
        nonEmpty: true,
        maxLength: 64,
      },
    ],
  },
  "tab.moveToSpace": {
    description: "Move a tab to another space.",
    params: [
      {
        name: "tabId",
        type: "integer",
        required: true,
        description: "Id of the tab to move.",
        min: 0,
      },
      {
        name: "spaceId",
        type: "string",
        required: true,
        description: "Id of the destination space, from space.list.",
        nonEmpty: true,
        maxLength: 64,
      },
    ],
  },
  "watch.list": {
    description:
      "List the watches: command, interval, state, run and change counts, and when each last ran and last changed.",
    params: [],
  },
  "watch.read": {
    description:
      "Read one watch with the output of its last run, secrets redacted.",
    params: [WATCH_ID],
  },
  "watch.add": {
    description:
      "Start a watch: a command polled on an interval that reports when its output changes. Use it to follow a pull request, a deploy or a build without spending agent turns while nothing happens.",
    params: watchParams(true),
  },
  "watch.update": {
    description: "Edit a watch. Changing its command resets what it compares against.",
    params: [WATCH_ID, ...watchParams(false)],
    anyOf: ["name", "command", "intervalSeconds", "cwd", "onChange", "prompt"],
  },
  "watch.remove": {
    description: "Stop and delete a watch.",
    params: [WATCH_ID],
  },
  "watch.setEnabled": {
    description: "Pause or resume a watch without losing its history.",
    params: [
      WATCH_ID,
      {
        name: "enabled",
        type: "boolean",
        required: true,
        description: "True to resume polling, false to pause it.",
      },
    ],
  },
  "watch.run": {
    description: "Run a watch now, outside its interval, and report whether its output changed.",
    params: [WATCH_ID],
  },
  "chat.layout": {
    description:
      "Place the Terax AI chat: a floating window, docked to the left or right of the workspace (it stays while tabs change), or a pane above the bottom input bar.",
    params: [
      {
        name: "mode",
        type: "enum",
        required: true,
        description: "floating, left, right or bottom.",
        values: [...CHAT_LAYOUT_MODES],
      },
      {
        name: "show",
        type: "boolean",
        required: false,
        description: "Show the chat after placing it (default true); false hides it.",
      },
    ],
  },
  "reader.open": {
    description:
      "Open a text in a Reader tab: a read-along view that speaks it with the local voice and highlights each word. Give the text itself, or the absolute path of a UTF-8 file (up to 2 MiB; Markdown is laid out). The same text always reopens the same document, with its reading position and cut points. Returns the tab id, the document id and the title.",
    params: [
      {
        name: "text",
        type: "string",
        required: false,
        description: "Text to read. Prefer path for long documents.",
        maxLength: READER_TEXT_MAX_CHARS,
        nonEmpty: true,
      },
      {
        name: "path",
        type: "string",
        required: false,
        description: "Absolute path of a text or Markdown file.",
        maxLength: 4096,
        nonEmpty: true,
      },
      {
        name: "title",
        type: "string",
        required: false,
        description: "Title for the tab; defaults to the file name.",
        maxLength: 200,
      },
      {
        name: "play",
        type: "boolean",
        required: false,
        description: "Start reading right away from the saved position (default false).",
      },
      {
        name: "stdin",
        type: "boolean",
        required: false,
        description: "The path is a temporary copy of piped input: do not keep it as the source.",
      },
    ],
    anyOf: ["text", "path"],
  },
  "reader.list": {
    description:
      "List the Reader library: every document read before, newest first, with its id, title, source path, word count and where reading stopped.",
    params: [],
  },
  "reader.state": {
    description:
      "Read a Reader document's state: phase (idle, loading, playing, paused, gap, finished), the word being read and its index, position and total time, speed, voice and every cut point. Defaults to the document playing, else the Reader tab on screen.",
    params: [READER_DOC_ID],
  },
  "reader.control": {
    description:
      "Drive a Reader document with op: play (from wordIndex, else from where it stopped), pause, toggle, stop, next or previous sentence, or seek to wordIndex or positionMs. speedPercent (75 to 250) sets the reading speed with any op.",
    params: [
      {
        // Not "action": MCP tools already use that name to pick the action.
        name: "op",
        type: "enum",
        required: true,
        description: "play, pause, toggle, stop, next, previous or seek.",
        values: [...READER_CONTROL_ACTIONS],
      },
      READER_DOC_ID,
      {
        name: "wordIndex",
        type: "integer",
        required: false,
        description: "Word to play or seek to, from reader.state or the document text.",
        min: 0,
      },
      {
        name: "positionMs",
        type: "integer",
        required: false,
        description: "Document time to seek to, at 1x, scripted pauses included.",
        min: 0,
      },
      {
        name: "speedPercent",
        type: "integer",
        required: false,
        description: "Reading speed as a percentage: 100 is normal, 150 is 1.5x.",
        min: 75,
        max: 250,
      },
    ],
  },
  "reader.mark": {
    description:
      "Place or remove a cut point before a word: a bookmark (a start point; in study mode playback stops there), a scripted pause (silence of pauseMs, default 1500) or a stop (playback halts there). Pauses and stops also split the audio there.",
    params: [
      {
        name: "wordIndex",
        type: "integer",
        required: true,
        description: "The cut sits before this word.",
        min: 0,
      },
      {
        name: "kind",
        type: "enum",
        required: true,
        description: "bookmark, pause or stop.",
        values: [...READER_CUT_KINDS],
      },
      READER_DOC_ID,
      {
        name: "label",
        type: "string",
        required: false,
        description: "Label shown in the gutter and used as a chapter title on export.",
        maxLength: 120,
      },
      {
        name: "pauseMs",
        type: "integer",
        required: false,
        description: "Length of a pause in milliseconds (0 to 60000).",
        min: 0,
        max: 60_000,
      },
      {
        name: "remove",
        type: "boolean",
        required: false,
        description: "Remove the cut of this kind at this word instead of placing it.",
      },
    ],
  },
  "reader.export": {
    description:
      "Export a Reader document as one WAV file with its scripted pauses, synthesizing any sentence not made yet, plus chapter files from headings and bookmarks. Returns the file path. Long documents take a while.",
    params: [READER_DOC_ID],
  },
};

function publicParam(param: ControlParam): CommandParamSchema {
  return {
    name: param.name,
    type: param.type,
    required: param.required,
    description: param.description,
    ...(param.values ? { values: [...param.values] } : {}),
  };
}

export const CONTROL_COMMAND_SCHEMAS = Object.fromEntries(
  CONTROL_COMMAND_IDS.map((id) => [
    id,
    {
      id,
      description: CONTROL_SPECS[id].description,
      params: CONTROL_SPECS[id].params.map(publicParam),
    },
  ]),
) as {
  [K in ControlCommandId]: {
    id: K;
    description: string;
    params: CommandParamSchema[];
  };
};

export function isControlCommandId(value: unknown): value is ControlCommandId {
  return (
    typeof value === "string" &&
    (CONTROL_COMMAND_IDS as readonly string[]).includes(value)
  );
}

type Validation =
  | { ok: true; value: Record<string, unknown> | undefined }
  | { ok: false; message: string };

const CONTROL_BYTES = /[\x00-\x1f\x7f]/;

function checkParam(
  id: ControlCommandId,
  param: ControlParam,
  value: unknown,
): string | null {
  const label = `${id} ${param.name}`;
  if (param.type === "integer") {
    if (typeof value !== "number" || !Number.isInteger(value))
      return `${label} must be an integer`;
    if (param.min !== undefined && value < param.min)
      return `${label} must be at least ${param.min}`;
    if (param.max !== undefined && value > param.max)
      return `${label} must be at most ${param.max}`;
    return null;
  }
  if (param.type === "boolean") {
    return typeof value === "boolean" ? null : `${label} must be a boolean`;
  }
  if (typeof value !== "string") return `${label} must be a string`;
  if (param.type === "enum") {
    return param.values?.includes(value)
      ? null
      : `${label} must be one of: ${(param.values ?? []).join(", ")}`;
  }
  if ((param.nonEmpty || param.shell) && value.trim().length === 0)
    return `${label} must not be empty`;
  if (param.maxLength !== undefined && value.length > param.maxLength)
    return `${label} is limited to ${param.maxLength} characters`;
  if (param.typed && CONTROL_BYTES.test(value))
    return `${label} must be a single line without control characters`;
  if (param.shell) {
    const safety = checkShellCommand(value);
    if (!safety.ok) return `${label}: ${safety.reason}`;
  }
  return null;
}

/** Validate a control command's payload against its param table. Unknown
 *  fields are refused so a typo never silently becomes a default. */
export function validateControlPayload(
  id: ControlCommandId,
  payload: unknown,
): Validation {
  const spec = CONTROL_SPECS[id];
  const absent = payload === undefined || payload === null;
  if (spec.params.length === 0) {
    return absent
      ? { ok: true, value: undefined }
      : { ok: false, message: `${id} does not accept a payload` };
  }
  const allOptional = spec.params.every((p) => !p.required);
  if (absent && allOptional) return { ok: true, value: {} };
  if (typeof payload !== "object" || absent || Array.isArray(payload))
    return { ok: false, message: `${id} requires an object payload` };

  const input = payload as Record<string, unknown>;
  const known = new Set(spec.params.map((p) => p.name));
  for (const key of Object.keys(input)) {
    if (!known.has(key))
      return { ok: false, message: `${id} does not accept "${key}"` };
  }

  const value: Record<string, unknown> = {};
  for (const param of spec.params) {
    const raw = input[param.name];
    if (raw === undefined || raw === null) {
      if (param.required)
        return { ok: false, message: `${id} requires ${param.name}` };
      continue;
    }
    const problem = checkParam(id, param, raw);
    if (problem) return { ok: false, message: problem };
    value[param.name] = raw;
  }

  if (spec.anyOf && !spec.anyOf.some((name) => name in value))
    return {
      ok: false,
      message: `${id} requires at least one of: ${spec.anyOf.join(", ")}`,
    };

  if (
    id === "terminal.send" &&
    value.submit !== false &&
    typeof value.text === "string"
  ) {
    const safety = checkShellCommand(value.text);
    if (!safety.ok)
      return { ok: false, message: `terminal.send text: ${safety.reason}` };
  }
  return { ok: true, value };
}

export function dispatchControlCommand(
  handlers: ControlHandlers,
  id: ControlCommandId,
  payload: unknown,
): Reply {
  const p = payload as never;
  switch (id) {
    case "terminal.list":
      return handlers.listTerminals();
    case "terminal.read":
      return handlers.readTerminal(p);
    case "terminal.open":
      return handlers.openTerminal(p);
    case "terminal.split":
      return handlers.splitTerminal(p);
    case "terminal.focus":
      return handlers.focusTerminal(p);
    case "terminal.close":
      return handlers.closeTerminal(p);
    case "terminal.send":
      return handlers.sendToTerminal(p);
    case "space.list":
      return handlers.listSpaces();
    case "space.focus":
      return handlers.focusSpace(p);
    case "tab.moveToSpace":
      return handlers.moveTabToSpace(p);
    case "watch.list":
      return handlers.listWatches();
    case "watch.read":
      return handlers.readWatch(p);
    case "watch.add":
      return handlers.addWatch(p);
    case "watch.update":
      return handlers.updateWatch(p);
    case "watch.remove":
      return handlers.removeWatch(p);
    case "watch.setEnabled":
      return handlers.setWatchEnabled(p);
    case "watch.run":
      return handlers.runWatch(p);
    case "chat.layout":
      return handlers.setChatLayout(p);
    case "reader.open":
      return handlers.openReader(p);
    case "reader.list":
      return handlers.listReader();
    case "reader.state":
      return handlers.readerState(p);
    case "reader.control":
      return handlers.controlReader(p);
    case "reader.mark":
      return handlers.markReader(p);
    case "reader.export":
      return handlers.exportReader(p);
  }
}
