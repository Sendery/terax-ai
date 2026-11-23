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
  "reader.dock",
  "reader.delete",
  "reader.generate",
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
export const READER_PLACEMENTS = ["dock", "tab"] as const;
export const READER_SPLITS = ["none", "heading", "paragraph", "sentence"] as const;

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
  "terminal.send": { leafId: number; text: string; submit?: boolean; sourceLeafId?: number };
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
    placement?: (typeof READER_PLACEMENTS)[number];
    tabId?: number;
    /** Set by `terax --read`: the pty of the terminal that ran it. */
    callerPtyId?: number;
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
  "reader.export": {
    docId?: string;
    split?: (typeof READER_SPLITS)[number];
    voiceId?: string;
  };
  "reader.generate": {
    text?: string;
    path?: string;
    docId?: string;
    title?: string;
    split?: (typeof READER_SPLITS)[number];
    voiceId?: string;
    show?: boolean;
  };
  "reader.dock": { tabId?: number; docId?: string; close?: boolean };
  "reader.delete": { docId?: string; all?: boolean };
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
  dockReader: (payload: ControlPayloads["reader.dock"]) => Reply;
  deleteReader: (payload: ControlPayloads["reader.delete"]) => Reply;
  generateReader: (payload: ControlPayloads["reader.generate"]) => Reply;
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

const READER_SPLIT: ControlParam = {
  name: "split",
  type: "enum",
  required: false,
  description: "none (default): one file. heading, paragraph or sentence: one file per fragment.",
  values: [...READER_SPLITS],
};

const READER_VOICE: ControlParam = {
  name: "voiceId",
  type: "string",
  required: false,
  description: "Voice profile id (see tts list_voices); it becomes the document's voice.",
  maxLength: 120,
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
        name: "sourceLeafId",
        type: "integer",
        required: false,
        min: 0,
        description: "Optional public source pane id from terminal.list. Records an explicit connection in Agent Flow.",
      },
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
      "Open a text in the Reader, a read-along view that speaks it with the local voice and highlights each word. By default it opens in the Reader panel docked under the tab on screen (or under tabId), so the user stays on that tab; placement tab opens a Reader tab instead. Give the text itself, or the absolute path of a UTF-8 file (up to 2 MiB; Markdown is laid out). The same text always reopens the same document, with its reading position and cut points. It opens paused unless play is true, so an agent never talks over what the user is hearing; a person's own actions start it themselves. Returns the tab id, the placement, the document id and the title.",
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
        description:
          "Title shown in the panel header and the library; defaults to the file name or the first words.",
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
      {
        name: "placement",
        type: "enum",
        required: false,
        description: "dock (default): the panel under a tab. tab: a Reader tab of its own.",
        values: [...READER_PLACEMENTS],
      },
      {
        name: "tabId",
        type: "integer",
        required: false,
        description: "Tab to dock the panel under, from the snapshot; defaults to the tab on screen.",
        min: 0,
      },
      {
        name: "callerPtyId",
        type: "integer",
        required: false,
        description:
          "Set by terax-read: the terminal that ran it, so the panel opens under that terminal's tab while it is open. Ignored when tabId is given or that terminal is gone.",
        min: 0,
      },
    ],
    anyOf: ["text", "path"],
  },
  "reader.list": {
    description:
      "List the Reader library: every document read before, newest first, with its id, title, source path, word count, where reading stopped, the tab it was made in (originTabId while that tab is open) and the tabs that show it now.",
    params: [],
  },
  "reader.state": {
    description:
      "Read a Reader document's state: phase (idle, loading, playing, paused, gap, finished), the word being read and its index, position and total time, speed, voice and every cut point. Defaults to the document playing, else the one on screen (Reader tab or docked panel). Never opens anything.",
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
      "Start exporting a Reader document as audio, synthesizing any sentence not made yet. split none (default) writes one WAV with its scripted pauses plus chapter files from headings and bookmarks; heading, paragraph or sentence writes one numbered WAV per section, paragraph or sentence into a folder with index.json and playlist.m3u. Returns at once; poll reader.state, whose export field shows progress, then the files or the error.",
    params: [READER_DOC_ID, READER_SPLIT, READER_VOICE],
  },
  "reader.generate": {
    description:
      "Generate the audio of a text in the background: give the text, an absolute path or a Reader docId. It is split into sentences, headings, list items and table rows for synthesis, then written as audio fragments by split (paragraph by default: one WAV per paragraph, with a heading joined to the paragraph it introduces; heading: one per section; sentence: one per sentence; none: one file). Nothing opens unless show is true. Returns the docId at once; poll reader.state for progress and the list of files.",
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
        description: "Absolute path of a text or Markdown file (up to 2 MiB).",
        maxLength: 4096,
        nonEmpty: true,
      },
      READER_DOC_ID,
      {
        name: "title",
        type: "string",
        required: false,
        description: "Title, also the export folder name; defaults to the file name or the first words.",
        maxLength: 200,
      },
      { ...READER_SPLIT, description: "How to cut the audio: paragraph (default), heading, sentence or none." },
      READER_VOICE,
      {
        name: "show",
        type: "boolean",
        required: false,
        description:
          "Also show the reading: in the Reader panel under the tab on screen, or in a Reader tab beside it when the tab on screen is a Reader tab. The reply's shown field says where.",
      },
    ],
    anyOf: ["text", "path", "docId"],
  },
  "reader.dock": {
    description:
      "Show or close the Reader panel docked under a tab (default: the tab on screen). With docId it shows that document, without it the library of readings; close hides the panel and stops the reading if nothing else shows it. Reader tabs have no panel.",
    params: [
      {
        name: "tabId",
        type: "integer",
        required: false,
        description: "Tab whose panel to change, from the snapshot.",
        min: 0,
      },
      READER_DOC_ID,
      {
        name: "close",
        type: "boolean",
        required: false,
        description: "Close the panel instead of showing it.",
      },
    ],
  },
  "reader.delete": {
    description:
      "Delete Reader documents from the library with their audio: one by docId, or every one with all. Panels and Reader tabs showing them let go of them.",
    params: [
      READER_DOC_ID,
      {
        name: "all",
        type: "boolean",
        required: false,
        description: "Delete every document in the library.",
      },
    ],
    anyOf: ["docId", "all"],
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
    case "reader.dock":
      return handlers.dockReader(p);
    case "reader.delete":
      return handlers.deleteReader(p);
    case "reader.generate":
      return handlers.generateReader(p);
  }
}
