import {
  CAPTURE_TARGETS,
  type CaptureOutcome,
  type CaptureRequest,
  validateCaptureRequest,
} from "@/modules/capture";
import { validateMermaidSource } from "@/modules/mermaid";
import { isLoopbackPreviewUrl } from "@/modules/preview";
import type { SettingsTab } from "@/modules/settings/openSettingsWindow";
import type { SidebarViewId } from "@/modules/sidebar";
import { isTabColor, TAB_COLORS, type TabColor } from "@/modules/tabs";
import { TASK_AGENTS, type TaskAgent } from "@/modules/tasks/lib/agents";
import { parseScheduleSpec } from "@/modules/tasks/lib/spec";
import {
  MISSED_POLICIES,
  type MissedPolicy,
  OVERLAP_POLICIES,
  type OverlapPolicy,
  TASK_MODES,
  TASK_TARGETS,
  type TaskMode,
  type TaskTarget,
} from "@/modules/tasks/lib/task";
import { DEFAULT_MAX_TOTAL } from "@/modules/tts/lib/chunk";
import {
  isTtsEngineId,
  isTtsLanguage,
  isTtsModelId,
  TTS_ENGINES,
  TTS_LANGUAGES,
  TTS_MODELS,
  type TtsEngineId,
  type TtsLanguage,
  type TtsModelId,
} from "@/modules/tts/lib/engines";
import type { AppSnapshot } from "./snapshot";

export const COMMAND_IDS = [
  "app.snapshot",
  "app.commands",
  "app.buildInfo",
  "app.capture",
  "sidebar.show",
  "sidebar.hide",
  "tab.openFile",
  "preview.open",
  "mermaid.open",
  "mermaid.update",
  "tab.focus",
  "tab.close",
  "tab.rename",
  "tab.resetTitle",
  "tab.setColor",
  "tab.move",
  "tab.setPinned",
  "git.diff.open",
  "git.history.open",
  "git.commitFile.open",
  "search.content",
  "settings.open",
  "agent-monitor.show",
  "agent-monitor.hide",
  "agent-monitor.toggle",
  "notes.show",
  "notes.hide",
  "notes.toggle",
  "notes.detach",
  "notes.attach",
  "notes.add",
  "notes.remove",
  "notes.update",
  "notes.list",
  "tasks.show",
  "tasks.hide",
  "tasks.toggle",
  "history.show",
  "history.hide",
  "history.toggle",
  "tasks.openEditor",
  "tasks.list",
  "tasks.add",
  "tasks.update",
  "tasks.clone",
  "tasks.reseed",
  "tasks.remove",
  "tasks.run",
  "tasks.setEnabled",
  "tasks.pauseAll",
  "tasks.resumeAll",
  "tasks.wake",
  "tts.status",
  "tts.start",
  "tts.stop",
  "tts.install",
  "tts.download",
  "tts.voices",
  "tts.speak",
  "tts.stopSpeaking",
] as const;

export type CommandId = (typeof COMMAND_IDS)[number];

export const PI_ALLOWED_COMMAND_IDS: CommandId[] = [...COMMAND_IDS];

export type CommandErrorCode =
  | "unknown_command"
  | "invalid_payload"
  | "command_failed"
  | "internal_error";

export type CommandError = {
  code: CommandErrorCode;
  message: string;
};

export type CommandResult<T = unknown> =
  | { ok: true; value: T }
  | { ok: false; error: CommandError };

export type CommandPayloads = {
  "app.snapshot": undefined;
  "app.commands": undefined;
  "app.buildInfo": undefined;
  "app.capture": CaptureRequest;
  "sidebar.show": { view?: SidebarViewId };
  "sidebar.hide": undefined;
  "tab.openFile": { path: string; pin?: boolean };
  "preview.open": { url: string; title?: string };
  "mermaid.open": { source: string; title?: string };
  "mermaid.update": { tabId: number; source: string; title?: string };
  "tab.focus": { tabId: number };
  "tab.close": { tabId?: number };
  "tab.rename": { tabId: number; title: string };
  "tab.resetTitle": { tabId: number };
  "tab.setColor": { tabId: number; color: TabColor | null };
  "tab.move": { tabId: number; index: number };
  "tab.setPinned": { tabId: number; pinned: boolean };
  "git.diff.open": {
    repoRoot: string;
    path: string;
    mode: "-" | "+";
    originalPath?: string | null;
    title?: string;
  };
  "git.history.open": { repoRoot: string; branch?: string };
  "git.commitFile.open": {
    repoRoot: string;
    sha: string;
    path: string;
    originalPath?: string | null;
    subject?: string;
  };
  "search.content": {
    query: string;
    root: string;
    caseInsensitive?: boolean;
    maxResults?: number;
  };
  "settings.open": { tab?: SettingsTab };
  "agent-monitor.show": undefined;
  "agent-monitor.hide": undefined;
  "agent-monitor.toggle": undefined;
  "notes.show": undefined;
  "notes.hide": undefined;
  "notes.toggle": undefined;
  "notes.detach": undefined;
  "notes.attach": undefined;
  "notes.add": { content: string };
  "notes.remove": { id: string };
  "notes.update": {
    id: string;
    title?: string;
    body?: string;
    url?: string;
    note?: string;
  };
  "notes.list": undefined;
  "tasks.show": undefined;
  "tasks.hide": undefined;
  "tasks.toggle": undefined;
  "history.show": undefined;
  "history.hide": undefined;
  "history.toggle": undefined;
  "tasks.openEditor": { id?: string };
  "tasks.list": undefined;
  "tasks.add": TaskCommandFields & {
    name: string;
    prompt: string;
    schedule: string;
  };
  "tasks.update": TaskCommandFields & {
    id: string;
    name?: string;
    prompt?: string;
    schedule?: string;
    enabled?: boolean;
  };
  "tasks.clone": { id: string };
  "tasks.reseed": { id: string };
  "tasks.remove": { id: string };
  "tasks.run": { id: string };
  "tasks.setEnabled": { id: string; enabled: boolean };
  "tasks.pauseAll": undefined;
  "tasks.resumeAll": undefined;
  "tasks.wake": undefined;
  "tts.status": undefined;
  "tts.start": { engine: TtsEngineId };
  "tts.stop": { engine?: TtsEngineId };
  "tts.install": { engine: TtsEngineId };
  "tts.download": { model: TtsModelId };
  "tts.voices": undefined;
  "tts.speak": { text: string; voiceId?: string; language?: TtsLanguage };
  "tts.stopSpeaking": undefined;
};

/** Optional configuration shared by tasks.add and tasks.update. */
export type TaskCommandFields = {
  cwd?: string;
  target?: TaskTarget;
  mode?: TaskMode;
  agent?: TaskAgent;
  missed?: MissedPolicy;
  overlap?: OverlapPolicy;
  sessionId?: string;
  model?: string;
  provider?: string;
  thinking?: string;
  maxRuns?: number;
  tabId?: number;
};

export type CommandParamType = "string" | "integer" | "boolean" | "enum";

export type CommandParamSchema = {
  name: string;
  type: CommandParamType;
  required: boolean;
  description: string;
  /** For enum params, the closed set of accepted values. */
  values?: readonly string[];
  /** Whether null is an accepted value in addition to the declared type. */
  nullable?: boolean;
};

export type CommandSchema = {
  id: CommandId;
  description: string;
  params: CommandParamSchema[];
};

export type CommandCatalog = {
  version: 1;
  commands: CommandSchema[];
};

// Single source of truth for the arguments each command accepts. Kept beside
// the validators so a read action can report supported arguments without the
// caller guessing, and so drift between docs and validation is visible here.
const TASK_OPTIONAL_PARAMS: readonly CommandParamSchema[] = [
  {
    name: "cwd",
    type: "string",
    required: false,
    description:
      "Working directory for the run. Defaults to the active tab's directory.",
  },
  {
    name: "target",
    type: "enum",
    required: false,
    description:
      "Where the run happens: a terminal tab (reused or created) or headless.",
    values: [...TASK_TARGETS],
  },
  {
    name: "mode",
    type: "enum",
    required: false,
    description:
      "task keeps one session so context accumulates; routine starts a fresh session each run.",
    values: [...TASK_MODES],
  },
  {
    name: "agent",
    type: "enum",
    required: false,
    description:
      "Agent CLI the run drives. pi and claude can be pinned to a session; codex mints its own ids and can only resume its most recent session in the directory.",
    values: [...TASK_AGENTS],
  },
  {
    name: "missed",
    type: "enum",
    required: false,
    description: "What to do with occurrences missed while Terax was closed.",
    values: [...MISSED_POLICIES],
  },
  {
    name: "overlap",
    type: "enum",
    required: false,
    description: "What to do when the previous run is still going.",
    values: [...OVERLAP_POLICIES],
  },
  {
    name: "sessionId",
    type: "string",
    required: false,
    description:
      "Existing Pi session to wake. Omit to let Terax own a session for the task.",
  },
  {
    name: "model",
    type: "string",
    required: false,
    description:
      "Model for the run, passed verbatim to the agent CLI. Omit to inherit its default.",
  },
  {
    name: "provider",
    type: "string",
    required: false,
    description: "Provider for the run. Pi only. Omit to inherit its default.",
  },
  {
    name: "thinking",
    type: "string",
    required: false,
    description: "Thinking level for the run. Pi only. Omit to inherit its default.",
  },
  {
    name: "maxRuns",
    type: "integer",
    required: false,
    description: "Stop after this many runs. Omit for unlimited.",
  },
  {
    name: "tabId",
    type: "integer",
    required: false,
    description: "Terminal tab this task belongs to, for tab runs.",
  },
];

const SCHEDULE_DESCRIPTION =
  "Schedule spec: manual, every:30m, every:2h, every:1d, daily:09:00, weekly:mon,wed@07:30, weekly:weekdays@08:00, weekly:weekend@10:00, days:3@06:00:2026-08-01, dates:2026-08-04,2026-08-09@12:00, once:2026-08-04T09:15.";

const TASK_ADD_PARAMS: readonly CommandParamSchema[] = [
  {
    name: "name",
    type: "string",
    required: true,
    description: "Short label shown on the card.",
  },
  {
    name: "prompt",
    type: "string",
    required: true,
    description: "Prompt sent to the Pi session. Multiple lines are allowed.",
  },
  {
    name: "schedule",
    type: "string",
    required: true,
    description: SCHEDULE_DESCRIPTION,
  },
  ...TASK_OPTIONAL_PARAMS,
];

const TASK_UPDATE_PARAMS: readonly CommandParamSchema[] = [
  {
    name: "id",
    type: "string",
    required: true,
    description: "Id of the task to edit.",
  },
  {
    name: "name",
    type: "string",
    required: false,
    description: "New label.",
  },
  {
    name: "prompt",
    type: "string",
    required: false,
    description: "New prompt.",
  },
  {
    name: "schedule",
    type: "string",
    required: false,
    description: SCHEDULE_DESCRIPTION,
  },
  {
    name: "enabled",
    type: "boolean",
    required: false,
    description: "Enable or disable the task.",
  },
  ...TASK_OPTIONAL_PARAMS,
];

const COMMAND_SCHEMAS: Record<CommandId, CommandSchema> = {
  "app.snapshot": {
    id: "app.snapshot",
    description: "Return a redacted snapshot of the window state.",
    params: [],
  },
  "app.commands": {
    id: "app.commands",
    description:
      "List every command id with its supported arguments (this catalog).",
    params: [],
  },
  "app.buildInfo": {
    id: "app.buildInfo",
    description:
      "Read the running app's source provenance (repository, branch, commit, channel) so a client can clone the exact source to develop against.",
    params: [],
  },
  "app.capture": {
    id: "app.capture",
    description:
      "Rasterize a Terax surface inside the webview (no OS capture APIs) and persist it as a PNG in the app cache. Returns the file path and dimensions. Refused when a private terminal is in scope.",
    params: [
      {
        name: "target",
        type: "enum",
        required: true,
        description: "Surface to capture.",
        values: CAPTURE_TARGETS,
      },
      {
        name: "tabId",
        type: "integer",
        required: false,
        description: "Tab id, required when target is 'pane'.",
      },
    ],
  },
  "sidebar.show": {
    id: "sidebar.show",
    description: "Show the sidebar, optionally selecting a view.",
    params: [
      {
        name: "view",
        type: "enum",
        required: false,
        description: "Sidebar view to reveal.",
        values: ["explorer", "source-control"],
      },
    ],
  },
  "sidebar.hide": {
    id: "sidebar.hide",
    description: "Hide the sidebar.",
    params: [],
  },
  "tab.openFile": {
    id: "tab.openFile",
    description: "Open a file in an editor tab.",
    params: [
      {
        name: "path",
        type: "string",
        required: true,
        description: "Absolute or workspace path to open.",
      },
      {
        name: "pin",
        type: "boolean",
        required: false,
        description: "Pin the tab instead of opening it as a preview.",
      },
    ],
  },
  "preview.open": {
    id: "preview.open",
    description:
      "Open (or focus) a web preview tab for a loopback URL. Only http(s) URLs on localhost/127.0.0.1/[::1] are accepted.",
    params: [
      {
        description:
          "Loopback URL to load, including scheme (e.g. http://localhost:5173).",
        name: "url",
        required: true,
        type: "string",
      },
      {
        description:
          "Custom tab title; defaults to a title derived from the URL.",
        name: "title",
        required: false,
        type: "string",
      },
    ],
  },
  "mermaid.open": {
    id: "mermaid.open",
    description:
      "Open Mermaid source in a live split editor and diagram preview tab.",
    params: [
      {
        name: "source",
        type: "string",
        required: true,
        description: "Mermaid source, with or without a fenced mermaid block.",
      },
      {
        name: "title",
        type: "string",
        required: false,
        description: "Optional tab title, limited to 80 characters.",
      },
    ],
  },
  "mermaid.update": {
    id: "mermaid.update",
    description:
      "Replace the source of an existing Mermaid tab without exposing its contents.",
    params: [
      {
        name: "tabId",
        type: "integer",
        required: true,
        description:
          "Id of the Mermaid tab returned by mermaid.open or app.snapshot.",
      },
      {
        name: "source",
        type: "string",
        required: true,
        description:
          "Replacement Mermaid source, with or without a fenced block.",
      },
      {
        name: "title",
        type: "string",
        required: false,
        description:
          "Optional replacement tab title, limited to 80 characters.",
      },
    ],
  },
  "tab.focus": {
    id: "tab.focus",
    description: "Focus an existing tab by id.",
    params: [
      {
        name: "tabId",
        type: "integer",
        required: true,
        description: "Id of the tab to focus.",
      },
    ],
  },
  "tab.close": {
    id: "tab.close",
    description: "Close a tab (defaults to the active tab).",
    params: [
      {
        name: "tabId",
        type: "integer",
        required: false,
        description: "Id of the tab to close; omit for the active tab.",
      },
    ],
  },
  "tab.rename": {
    id: "tab.rename",
    description: "Set a custom title on a tab.",
    params: [
      {
        name: "tabId",
        type: "integer",
        required: true,
        description: "Id of the tab to rename.",
      },
      {
        name: "title",
        type: "string",
        required: true,
        description: "New custom title.",
      },
    ],
  },
  "tab.resetTitle": {
    id: "tab.resetTitle",
    description: "Clear a custom title and restore the derived one.",
    params: [
      {
        name: "tabId",
        type: "integer",
        required: true,
        description: "Id of the tab to reset.",
      },
    ],
  },
  "tab.setColor": {
    id: "tab.setColor",
    description: "Set or clear a tab's palette color.",
    params: [
      {
        name: "tabId",
        type: "integer",
        required: true,
        description: "Id of the tab to color.",
      },
      {
        name: "color",
        type: "enum",
        required: true,
        nullable: true,
        description: "Palette color, or null to clear the color.",
        values: TAB_COLORS,
      },
    ],
  },
  "tab.move": {
    id: "tab.move",
    description:
      "Reorder a tab within its own space, by destination index in that space's strip.",
    params: [
      {
        name: "tabId",
        type: "integer",
        required: true,
        description: "Id of the tab to move.",
      },
      {
        name: "index",
        type: "integer",
        required: true,
        description:
          "Zero-based destination index inside the tab's space. Clamped to the strip.",
      },
    ],
  },
  "tab.setPinned": {
    id: "tab.setPinned",
    description:
      "Pin or unpin an editor tab. A pinned tab keeps its slot; an unpinned one is the single preview slot the next opened file replaces.",
    params: [
      {
        name: "tabId",
        type: "integer",
        required: true,
        description: "Id of the editor tab.",
      },
      {
        name: "pinned",
        type: "boolean",
        required: true,
        description:
          "true to pin the tab, false to return it to the preview slot.",
      },
    ],
  },
  "git.diff.open": {
    id: "git.diff.open",
    description: "Open a git diff tab for a file.",
    params: [
      {
        name: "repoRoot",
        type: "string",
        required: true,
        description: "Repository root path.",
      },
      {
        name: "path",
        type: "string",
        required: true,
        description: "File path relative to the repo.",
      },
      {
        name: "mode",
        type: "enum",
        required: true,
        description: "Diff side: '-' for old, '+' for new.",
        values: ["-", "+"],
      },
      {
        name: "originalPath",
        type: "string",
        required: false,
        nullable: true,
        description: "Original path for renames.",
      },
      {
        name: "title",
        type: "string",
        required: false,
        description: "Custom tab title.",
      },
    ],
  },
  "git.history.open": {
    id: "git.history.open",
    description:
      "Open the commit graph for a repository. An already open graph for the same repository is focused instead of duplicated.",
    params: [
      {
        name: "repoRoot",
        type: "string",
        required: true,
        description: "Repository root path.",
      },
      {
        name: "branch",
        type: "string",
        required: false,
        description: "Branch name, used only to title the tab.",
      },
    ],
  },
  "git.commitFile.open": {
    id: "git.commitFile.open",
    description:
      "Open a file's diff as it was at one commit. Reuses an open tab for the same repository, commit and path.",
    params: [
      {
        name: "repoRoot",
        type: "string",
        required: true,
        description: "Repository root path.",
      },
      {
        name: "sha",
        type: "string",
        required: true,
        description:
          "Commit sha, 7 to 40 hexadecimal characters. Revision expressions are not accepted.",
      },
      {
        name: "path",
        type: "string",
        required: true,
        description: "File path relative to the repo, as of that commit.",
      },
      {
        name: "originalPath",
        type: "string",
        required: false,
        nullable: true,
        description: "Previous path when the commit renamed the file.",
      },
      {
        name: "subject",
        type: "string",
        required: false,
        description: "Commit subject line, shown as context in the tab.",
      },
    ],
  },
  "search.content": {
    id: "search.content",
    description:
      "Search file contents under a root with a regular expression, honoring .gitignore. Returns matches; it does not open a tab. Pair it with tab.openFile to open a hit.",
    params: [
      {
        name: "query",
        type: "string",
        required: true,
        description: "Regular expression in the ripgrep dialect.",
      },
      {
        name: "root",
        type: "string",
        required: true,
        description:
          "Directory to search under. Must be an authorized workspace path.",
      },
      {
        name: "caseInsensitive",
        type: "boolean",
        required: false,
        description: "Match without regard to case.",
      },
      {
        name: "maxResults",
        type: "integer",
        required: false,
        description: "Maximum hits to return, 1 to 500. Defaults to 50.",
      },
    ],
  },
  "settings.open": {
    id: "settings.open",
    description: "Open the settings window, optionally on a section.",
    params: [
      {
        name: "tab",
        type: "enum",
        required: false,
        description: "Settings section to deep-link.",
        values: [
          "general",
          "models",
          "voice",
          "agents",
          "themes",
          "shortcuts",
          "about",
        ],
      },
    ],
  },
  "agent-monitor.show": {
    id: "agent-monitor.show",
    description: "Show the Agent Monitor panel.",
    params: [],
  },
  "agent-monitor.hide": {
    id: "agent-monitor.hide",
    description: "Hide the Agent Monitor panel.",
    params: [],
  },
  "agent-monitor.toggle": {
    id: "agent-monitor.toggle",
    description: "Toggle the Agent Monitor panel.",
    params: [],
  },
  "notes.show": {
    id: "notes.show",
    description:
      "Show the notes panel (focuses the floating window when detached).",
    params: [],
  },
  "notes.hide": {
    id: "notes.hide",
    description: "Hide the notes panel.",
    params: [],
  },
  "notes.toggle": {
    id: "notes.toggle",
    description: "Toggle the notes panel.",
    params: [],
  },
  "notes.detach": {
    id: "notes.detach",
    description: "Pop the notes panel into the floating notes window.",
    params: [],
  },
  "notes.attach": {
    id: "notes.attach",
    description:
      "Dock the notes back into the panel and close the floating window.",
    params: [],
  },
  "notes.add": {
    id: "notes.add",
    description:
      "Add a note card to the active tab. A URL becomes a typed link card (Jira, GitHub PR, Notion, Figma, Obsidian); anything else becomes a text note.",
    params: [
      {
        name: "content",
        type: "string",
        required: true,
        description: "A URL or free text.",
      },
    ],
  },
  "notes.remove": {
    id: "notes.remove",
    description: "Remove a note card from the active tab by id.",
    params: [
      {
        name: "id",
        type: "string",
        required: true,
        description: "Id of the note card to remove.",
      },
    ],
  },
  "notes.update": {
    id: "notes.update",
    description:
      "Edit a note card on the active tab by id. Provide at least one field. title/note apply to any card; body applies to text notes; url applies to link cards. The card kind and provider are never changed.",
    params: [
      {
        name: "id",
        type: "string",
        required: true,
        description: "Id of the note card to edit.",
      },
      {
        name: "title",
        type: "string",
        required: false,
        description: "New title (empty string clears it).",
      },
      {
        name: "body",
        type: "string",
        required: false,
        description: "New text for a text note (ignored on link cards).",
      },
      {
        name: "url",
        type: "string",
        required: false,
        description: "New URL for a link card (ignored on text notes).",
      },
      {
        name: "note",
        type: "string",
        required: false,
        description: "New annotation for a link card (empty string clears it).",
      },
    ],
  },
  "notes.list": {
    id: "notes.list",
    description: "List the note cards on the active tab.",
    params: [],
  },
  "tasks.show": {
    id: "tasks.show",
    description: "Show the scheduled tasks panel.",
    params: [],
  },
  "tasks.hide": {
    id: "tasks.hide",
    description: "Hide the scheduled tasks panel.",
    params: [],
  },
  "tasks.toggle": {
    id: "tasks.toggle",
    description: "Toggle the scheduled tasks panel.",
    params: [],
  },
  "history.show": {
    id: "history.show",
    description:
      "Show the session history panel, which graphs the transcript of the agent running in the focused terminal.",
    params: [],
  },
  "history.hide": {
    id: "history.hide",
    description: "Hide the session history panel.",
    params: [],
  },
  "history.toggle": {
    id: "history.toggle",
    description: "Toggle the session history panel.",
    params: [],
  },
  "tasks.openEditor": {
    id: "tasks.openEditor",
    description:
      "Open the task editor so the user can review or complete a task. Omit the id to open it for a new task.",
    params: [
      {
        name: "id",
        type: "string",
        required: false,
        description: "Task to edit. Omit to start a new one.",
      },
    ],
  },
  "tasks.list": {
    id: "tasks.list",
    description:
      "List scheduled tasks with their schedule, state, next run and accumulated time, tokens and cost. Includes the prompt, which app.snapshot redacts.",
    params: [],
  },
  "tasks.add": {
    id: "tasks.add",
    description:
      "Create a scheduled task that wakes a Pi session with a prompt. The working directory defaults to the active tab's directory, which is what a task created from a Pi session should keep so the session can be resumed.",
    params: [...TASK_ADD_PARAMS],
  },
  "tasks.update": {
    id: "tasks.update",
    description:
      "Edit a scheduled task by id. Provide at least one field besides the id.",
    params: [...TASK_UPDATE_PARAMS],
  },
  "tasks.clone": {
    id: "tasks.clone",
    description:
      "Duplicate a scheduled task. The copy keeps the schedule, agent, model, directory and policies, starts with no run history and its own session, and lands disabled so it cannot fire before it has been reviewed. Opens it in the editor.",
    params: [
      {
        name: "id",
        type: "string",
        required: true,
        description: "Id of the task to duplicate.",
      },
    ],
  },
  "tasks.reseed": {
    id: "tasks.reseed",
    description:
      "Point a task at a brand new agent session, so its next run starts with no accumulated context. Schedule, run budget and history are untouched.",
    params: [
      {
        name: "id",
        type: "string",
        required: true,
        description: "Id of the task to reseed.",
      },
    ],
  },
  "tasks.remove": {
    id: "tasks.remove",
    description: "Delete a scheduled task and its run history.",
    params: [
      {
        name: "id",
        type: "string",
        required: true,
        description: "Id of the task to delete.",
      },
    ],
  },
  "tasks.run": {
    id: "tasks.run",
    description:
      "Run a scheduled task immediately, regardless of its schedule. Runs even while the global pause is engaged.",
    params: [
      {
        name: "id",
        type: "string",
        required: true,
        description: "Id of the task to run.",
      },
    ],
  },
  "tasks.setEnabled": {
    id: "tasks.setEnabled",
    description: "Enable or disable one scheduled task.",
    params: [
      {
        name: "id",
        type: "string",
        required: true,
        description: "Id of the task.",
      },
      {
        name: "enabled",
        type: "boolean",
        required: true,
        description: "True to schedule it, false to stop it.",
      },
    ],
  },
  "tasks.pauseAll": {
    id: "tasks.pauseAll",
    description:
      "Engage the global scheduler pause. Nothing fires on a schedule until resumed; manual runs still work.",
    params: [],
  },
  "tasks.resumeAll": {
    id: "tasks.resumeAll",
    description: "Release the global scheduler pause.",
    params: [],
  },
  "tasks.wake": {
    id: "tasks.wake",
    description:
      "Re-evaluate the schedule now and dispatch anything due. This is what the optional OS-level waker calls, and confirming it is how a running instance takes ownership of a wake.",
    params: [],
  },
  "tts.status": {
    id: "tts.status",
    description:
      "Read the local speech stack: runtime, engines (installed, running, device), downloaded models, install jobs, disk usage, and what this window is speaking right now. Bearer tokens are never returned.",
    params: [],
  },
  "tts.start": {
    id: "tts.start",
    description:
      "Start an engine's local sidecar on the configured device. Returns as soon as the start is requested, because loading a model outlasts the bridge timeout; poll tts.status until the engine reports running.",
    params: [
      {
        name: "engine",
        type: "enum",
        required: true,
        description: "Engine whose sidecar should be started.",
        values: TTS_ENGINES,
      },
    ],
  },
  "tts.stop": {
    id: "tts.stop",
    description:
      "Stop one engine sidecar, or every running one when the engine is omitted, freeing its memory. Returns the engines that were stopped.",
    params: [
      {
        name: "engine",
        type: "enum",
        required: false,
        description: "Engine to stop; omit to stop every running engine.",
        values: TTS_ENGINES,
      },
    ],
  },
  "tts.install": {
    id: "tts.install",
    description:
      "Install an engine into the private speech directory, installing the Python runtime first when it is missing. Returns a job id; read its progress with tts.status.",
    params: [
      {
        name: "engine",
        type: "enum",
        required: true,
        description: "Engine to install.",
        values: TTS_ENGINES,
      },
    ],
  },
  "tts.download": {
    id: "tts.download",
    description:
      "Download a model's weights into the private speech directory. The model's engine must already be installed. Returns a job id; read its progress with tts.status.",
    params: [
      {
        name: "model",
        type: "enum",
        required: true,
        description: "Model to download.",
        values: TTS_MODELS,
      },
    ],
  },
  "tts.voices": {
    id: "tts.voices",
    description:
      "List the configured voice profiles with their model, language, voice source and which one is the default for each language.",
    params: [],
  },
  "tts.speak": {
    id: "tts.speak",
    description:
      "Read text aloud locally. Returns once the queue is running, not when the audio ends, because synthesis outlasts the bridge timeout; poll tts.status for progress. Text is capped at 8192 characters and split into sentence-sized chunks.",
    params: [
      {
        name: "text",
        type: "string",
        required: true,
        description:
          "Text to speak, 1 to 8192 characters after trimming. Plain prose reads best; markup is spoken literally.",
      },
      {
        name: "voiceId",
        type: "string",
        required: false,
        description:
          "Voice profile id from tts.voices. Wins over language when both are given.",
      },
      {
        name: "language",
        type: "enum",
        required: false,
        description:
          "Language whose default voice profile should speak. Omit to use the preferred language.",
        values: TTS_LANGUAGES,
      },
    ],
  },
  "tts.stopSpeaking": {
    id: "tts.stopSpeaking",
    description:
      "Stop the audio this window is playing and drop the rest of the queue. The engine stays loaded.",
    params: [],
  },
};

export function describeCommands(): CommandCatalog {
  return {
    version: 1,
    commands: COMMAND_IDS.map((id) => structuredClone(COMMAND_SCHEMAS[id])),
  };
}

export type CommandRequest<K extends CommandId = CommandId> = {
  [P in K]: CommandPayloads[P] extends undefined
    ? { id: P; payload?: undefined }
    : { id: P; payload: CommandPayloads[P] };
}[K];

export type BuildInfoResult = {
  repository: string;
  branch: string;
  commit: string;
  channel: "development" | "official";
};

export type CommandHandlers = {
  getSnapshot: () => Promise<AppSnapshot> | AppSnapshot;
  getBuildInfo: () => Promise<BuildInfoResult> | BuildInfoResult;
  capture: (
    payload: CommandPayloads["app.capture"],
  ) => Promise<CaptureOutcome> | CaptureOutcome;
  showSidebar: (
    payload: CommandPayloads["sidebar.show"],
  ) => Promise<unknown> | unknown;
  hideSidebar: () => Promise<unknown> | unknown;
  openFile: (
    payload: CommandPayloads["tab.openFile"],
  ) => Promise<unknown> | unknown;
  openPreview: (
    payload: CommandPayloads["preview.open"],
  ) => Promise<unknown> | unknown;
  openMermaid: (
    payload: CommandPayloads["mermaid.open"],
  ) => Promise<unknown> | unknown;
  updateMermaid: (
    payload: CommandPayloads["mermaid.update"],
  ) => Promise<unknown> | unknown;
  focusTab: (
    payload: CommandPayloads["tab.focus"],
  ) => Promise<unknown> | unknown;
  closeTab: (
    payload: CommandPayloads["tab.close"],
  ) => Promise<unknown> | unknown;
  renameTab: (
    payload: CommandPayloads["tab.rename"],
  ) => Promise<unknown> | unknown;
  resetTabTitle: (
    payload: CommandPayloads["tab.resetTitle"],
  ) => Promise<unknown> | unknown;
  setTabColor: (
    payload: CommandPayloads["tab.setColor"],
  ) => Promise<unknown> | unknown;
  openGitDiff: (
    payload: CommandPayloads["git.diff.open"],
  ) => Promise<unknown> | unknown;
  openGitHistory: (
    payload: CommandPayloads["git.history.open"],
  ) => Promise<unknown> | unknown;
  openCommitFile: (
    payload: CommandPayloads["git.commitFile.open"],
  ) => Promise<unknown> | unknown;
  searchContent: (
    payload: CommandPayloads["search.content"],
  ) => Promise<unknown> | unknown;
  moveTab: (payload: CommandPayloads["tab.move"]) => Promise<unknown> | unknown;
  setTabPinned: (
    payload: CommandPayloads["tab.setPinned"],
  ) => Promise<unknown> | unknown;
  openSettings: (
    payload: CommandPayloads["settings.open"],
  ) => Promise<unknown> | unknown;
  showAgentMonitor: () => Promise<unknown> | unknown;
  hideAgentMonitor: () => Promise<unknown> | unknown;
  toggleAgentMonitor: () => Promise<unknown> | unknown;
  showNotes: () => Promise<unknown> | unknown;
  hideNotes: () => Promise<unknown> | unknown;
  toggleNotes: () => Promise<unknown> | unknown;
  detachNotes: () => Promise<unknown> | unknown;
  attachNotes: () => Promise<unknown> | unknown;
  addNote: (
    payload: CommandPayloads["notes.add"],
  ) => Promise<unknown> | unknown;
  removeNote: (
    payload: CommandPayloads["notes.remove"],
  ) => Promise<unknown> | unknown;
  updateNote: (
    payload: CommandPayloads["notes.update"],
  ) => Promise<unknown> | unknown;
  listNotes: () => Promise<unknown> | unknown;
  showTasks: () => Promise<unknown> | unknown;
  hideTasks: () => Promise<unknown> | unknown;
  toggleTasks: () => Promise<unknown> | unknown;
  showHistory: () => Promise<unknown> | unknown;
  hideHistory: () => Promise<unknown> | unknown;
  toggleHistory: () => Promise<unknown> | unknown;
  openTaskEditor: (
    payload: CommandPayloads["tasks.openEditor"],
  ) => Promise<unknown> | unknown;
  listTasks: () => Promise<unknown> | unknown;
  addTask: (
    payload: CommandPayloads["tasks.add"],
  ) => Promise<unknown> | unknown;
  updateTask: (
    payload: CommandPayloads["tasks.update"],
  ) => Promise<unknown> | unknown;
  cloneTask: (
    payload: CommandPayloads["tasks.clone"],
  ) => Promise<unknown> | unknown;
  reseedTask: (
    payload: CommandPayloads["tasks.reseed"],
  ) => Promise<unknown> | unknown;
  removeTask: (
    payload: CommandPayloads["tasks.remove"],
  ) => Promise<unknown> | unknown;
  runTask: (
    payload: CommandPayloads["tasks.run"],
  ) => Promise<unknown> | unknown;
  setTaskEnabled: (
    payload: CommandPayloads["tasks.setEnabled"],
  ) => Promise<unknown> | unknown;
  pauseAllTasks: () => Promise<unknown> | unknown;
  resumeAllTasks: () => Promise<unknown> | unknown;
  wakeTasks: () => Promise<unknown> | unknown;
  getTtsStatus: () => Promise<unknown> | unknown;
  startTtsEngine: (
    payload: CommandPayloads["tts.start"],
  ) => Promise<unknown> | unknown;
  stopTtsEngine: (
    payload: CommandPayloads["tts.stop"],
  ) => Promise<unknown> | unknown;
  installTtsEngine: (
    payload: CommandPayloads["tts.install"],
  ) => Promise<unknown> | unknown;
  downloadTtsModel: (
    payload: CommandPayloads["tts.download"],
  ) => Promise<unknown> | unknown;
  listTtsVoices: () => Promise<unknown> | unknown;
  speakTts: (
    payload: CommandPayloads["tts.speak"],
  ) => Promise<unknown> | unknown;
  stopTtsSpeaking: () => Promise<unknown> | unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCommandId(value: unknown): value is CommandId {
  return typeof value === "string" && COMMAND_IDS.includes(value as CommandId);
}

function invalidPayload(message: string): CommandResult<never> {
  return { ok: false, error: { code: "invalid_payload", message } };
}

function requireObject(
  id: CommandId,
  payload: unknown,
): CommandResult<Record<string, unknown>> {
  if (!isRecord(payload)) {
    return invalidPayload(`${id} requires an object payload`);
  }
  return { ok: true, value: payload };
}

function requireString(
  payload: Record<string, unknown>,
  key: string,
  id: CommandId,
): CommandResult<string> {
  const value = payload[key];
  if (typeof value !== "string" || value.length === 0) {
    return invalidPayload(`${id} requires payload.${key}`);
  }
  return { ok: true, value };
}

function requireNumber(
  payload: Record<string, unknown>,
  key: string,
  id: CommandId,
): CommandResult<number> {
  const value = payload[key];
  if (!Number.isInteger(value)) {
    return invalidPayload(`${id} requires payload.${key}`);
  }
  return { ok: true, value: value as number };
}

function validateOptionalString(
  value: unknown,
  id: CommandId,
  key: string,
): CommandResult<string | undefined> {
  if (value === undefined || typeof value === "string") {
    return { ok: true, value };
  }
  return invalidPayload(`${id} requires payload.${key} to be a string`);
}

function validateOptionalBoolean(
  value: unknown,
  id: CommandId,
  key: string,
): CommandResult<boolean | undefined> {
  if (value === undefined || typeof value === "boolean") {
    return { ok: true, value };
  }
  return invalidPayload(`${id} requires payload.${key} to be boolean`);
}

function validateSidebarView(value: unknown): value is SidebarViewId {
  return (
    value === undefined || value === "explorer" || value === "source-control"
  );
}

function validateSettingsTab(value: unknown): value is SettingsTab | undefined {
  return (
    value === undefined ||
    value === "general" ||
    value === "models" ||
    value === "voice" ||
    value === "agents" ||
    value === "themes" ||
    value === "shortcuts" ||
    value === "about"
  );
}

export function validateCommandRequest(
  input: unknown,
): CommandResult<CommandRequest> {
  if (!isRecord(input) || typeof input.id !== "string") {
    return {
      ok: false,
      error: { code: "unknown_command", message: "Missing command id" },
    };
  }
  if (!isCommandId(input.id)) {
    return {
      ok: false,
      error: {
        code: "unknown_command",
        message: `Unknown command "${input.id}"`,
      },
    };
  }

  const { id, payload } = input;
  if (
    id === "app.snapshot" ||
    id === "app.commands" ||
    id === "app.buildInfo" ||
    id === "sidebar.hide" ||
    id === "agent-monitor.show" ||
    id === "agent-monitor.hide" ||
    id === "agent-monitor.toggle" ||
    id === "notes.show" ||
    id === "notes.hide" ||
    id === "notes.toggle" ||
    id === "notes.detach" ||
    id === "notes.attach" ||
    id === "notes.list" ||
    id === "tasks.show" ||
    id === "tasks.hide" ||
    id === "tasks.toggle" ||
    id === "history.show" ||
    id === "history.hide" ||
    id === "history.toggle" ||
    id === "tasks.list" ||
    id === "tasks.pauseAll" ||
    id === "tasks.resumeAll" ||
    id === "tasks.wake" ||
    id === "tts.status" ||
    id === "tts.voices" ||
    id === "tts.stopSpeaking"
  ) {
    if (payload !== undefined && payload !== null) {
      return invalidPayload(`${id} does not accept a payload`);
    }
    return { ok: true, value: { id } as CommandRequest };
  }

  const acceptsEmptyPayload =
    id === "sidebar.show" ||
    id === "tab.close" ||
    id === "settings.open" ||
    id === "tasks.openEditor" ||
    id === "tts.stop";
  const objectPayload =
    acceptsEmptyPayload && (payload === undefined || payload === null)
      ? ({ ok: true, value: {} } as const)
      : requireObject(id, payload);
  if (!objectPayload.ok) return objectPayload;
  const obj: Record<string, unknown> = objectPayload.value;

  if (id === "app.capture") {
    const capture = validateCaptureRequest(obj);
    if (!capture.ok) return invalidPayload(capture.message);
    return { ok: true, value: { id, payload: capture.value } };
  }

  if (id === "sidebar.show") {
    if (!validateSidebarView(obj.view)) {
      return invalidPayload(
        "sidebar.show requires payload.view to be a sidebar view",
      );
    }
    return { ok: true, value: { id, payload: { view: obj.view } } };
  }

  if (id === "tab.openFile") {
    const path = requireString(obj, "path", id);
    if (!path.ok) return path;
    const pin = validateOptionalBoolean(obj.pin, id, "pin");
    if (!pin.ok) return pin;
    return {
      ok: true,
      value: { id, payload: { path: path.value, pin: pin.value } },
    };
  }

  if (id === "preview.open") {
    if (!isLoopbackPreviewUrl(obj.url)) {
      return invalidPayload(
        obj.url === undefined || obj.url === null || obj.url === ""
          ? "preview.open requires payload.url"
          : "preview.open requires payload.url to be an http(s) loopback URL",
      );
    }
    const title = validateOptionalString(obj.title, id, "title");
    if (!title.ok) return title;
    return {
      ok: true,
      value: { id, payload: { url: obj.url, title: title.value } },
    };
  }

  if (id === "mermaid.open") {
    const rawSource = requireString(obj, "source", id);
    if (!rawSource.ok) return rawSource;
    const source = validateMermaidSource(rawSource.value);
    if (!source.ok) return invalidPayload(source.message);
    const rawTitle = validateOptionalString(obj.title, id, "title");
    if (!rawTitle.ok) return rawTitle;
    const title = rawTitle.value?.trim() || undefined;
    if (title && title.length > 80) {
      return invalidPayload(
        "mermaid.open requires payload.title to be at most 80 characters",
      );
    }
    return {
      ok: true,
      value: { id, payload: { source: source.source, title } },
    };
  }

  if (id === "mermaid.update") {
    const tabId = requireNumber(obj, "tabId", id);
    if (!tabId.ok) return tabId;
    const rawSource = requireString(obj, "source", id);
    if (!rawSource.ok) return rawSource;
    const source = validateMermaidSource(rawSource.value);
    if (!source.ok) return invalidPayload(source.message);
    const rawTitle = validateOptionalString(obj.title, id, "title");
    if (!rawTitle.ok) return rawTitle;
    const title = rawTitle.value?.trim() || undefined;
    if (title && title.length > 80) {
      return invalidPayload(
        "mermaid.update requires payload.title to be at most 80 characters",
      );
    }
    return {
      ok: true,
      value: {
        id,
        payload: { tabId: tabId.value, source: source.source, title },
      },
    };
  }

  if (id === "tab.focus" || id === "tab.resetTitle") {
    const tabId = requireNumber(obj, "tabId", id);
    if (!tabId.ok) return tabId;
    return { ok: true, value: { id, payload: { tabId: tabId.value } } };
  }

  if (id === "tab.setColor") {
    const tabId = requireNumber(obj, "tabId", id);
    if (!tabId.ok) return tabId;
    if (obj.color !== null && !isTabColor(obj.color)) {
      return invalidPayload(
        "tab.setColor requires payload.color to be a palette color or null",
      );
    }
    return {
      ok: true,
      value: {
        id,
        payload: { tabId: tabId.value, color: obj.color as TabColor | null },
      },
    };
  }

  if (id === "tab.close") {
    if (obj.tabId !== undefined && !Number.isInteger(obj.tabId)) {
      return invalidPayload("tab.close requires payload.tabId");
    }
    const tabId = obj.tabId as number | undefined;
    return { ok: true, value: { id, payload: { tabId } } };
  }

  if (id === "tab.rename") {
    const tabId = requireNumber(obj, "tabId", id);
    if (!tabId.ok) return tabId;
    const title = requireString(obj, "title", id);
    if (!title.ok) return title;
    return {
      ok: true,
      value: { id, payload: { tabId: tabId.value, title: title.value } },
    };
  }

  if (id === "tab.move") {
    const tabId = requireNumber(obj, "tabId", id);
    if (!tabId.ok) return tabId;
    const index = requireNumber(obj, "index", id);
    if (!index.ok) return index;
    if (index.value < 0) {
      return invalidPayload("tab.move requires payload.index to be at least 0");
    }
    return {
      ok: true,
      value: { id, payload: { tabId: tabId.value, index: index.value } },
    };
  }

  if (id === "tab.setPinned") {
    const tabId = requireNumber(obj, "tabId", id);
    if (!tabId.ok) return tabId;
    if (typeof obj.pinned !== "boolean") {
      return invalidPayload(
        "tab.setPinned requires payload.pinned to be a boolean",
      );
    }
    return {
      ok: true,
      value: { id, payload: { tabId: tabId.value, pinned: obj.pinned } },
    };
  }

  if (id === "git.history.open") {
    const repoRoot = requireString(obj, "repoRoot", id);
    if (!repoRoot.ok) return repoRoot;
    const branch = validateOptionalString(obj.branch, id, "branch");
    if (!branch.ok) return branch;
    return {
      ok: true,
      value: {
        id,
        payload: { repoRoot: repoRoot.value, branch: branch.value },
      },
    };
  }

  if (id === "git.commitFile.open") {
    const repoRoot = requireString(obj, "repoRoot", id);
    if (!repoRoot.ok) return repoRoot;
    const sha = requireString(obj, "sha", id);
    if (!sha.ok) return sha;
    // A sha reaches git as an argument, so only a literal object name is
    // accepted here. Revision expressions such as HEAD~1 or @{u} are not.
    if (!/^[0-9a-fA-F]{7,40}$/.test(sha.value)) {
      return invalidPayload(
        "git.commitFile.open requires payload.sha to be 7 to 40 hexadecimal characters",
      );
    }
    const path = requireString(obj, "path", id);
    if (!path.ok) return path;
    if (
      obj.originalPath !== undefined &&
      obj.originalPath !== null &&
      typeof obj.originalPath !== "string"
    ) {
      return invalidPayload(
        "git.commitFile.open requires payload.originalPath to be a string",
      );
    }
    const subject = validateOptionalString(obj.subject, id, "subject");
    if (!subject.ok) return subject;
    return {
      ok: true,
      value: {
        id,
        payload: {
          repoRoot: repoRoot.value,
          sha: sha.value,
          path: path.value,
          originalPath: (obj.originalPath as string | null | undefined) ?? null,
          subject: subject.value,
        },
      },
    };
  }

  if (id === "search.content") {
    const query = requireString(obj, "query", id);
    if (!query.ok) return query;
    if (!query.value.trim()) {
      return invalidPayload(
        "search.content requires a non-empty payload.query",
      );
    }
    const root = requireString(obj, "root", id);
    if (!root.ok) return root;
    if (
      obj.caseInsensitive !== undefined &&
      typeof obj.caseInsensitive !== "boolean"
    ) {
      return invalidPayload(
        "search.content requires payload.caseInsensitive to be a boolean",
      );
    }
    let maxResults: number | undefined;
    if (obj.maxResults !== undefined) {
      const parsed = requireNumber(obj, "maxResults", id);
      if (!parsed.ok) return parsed;
      if (parsed.value < 1 || parsed.value > 500) {
        return invalidPayload(
          "search.content requires payload.maxResults between 1 and 500",
        );
      }
      maxResults = parsed.value;
    }
    return {
      ok: true,
      value: {
        id,
        payload: {
          query: query.value,
          root: root.value,
          caseInsensitive: obj.caseInsensitive as boolean | undefined,
          maxResults,
        },
      },
    };
  }

  if (id === "git.diff.open") {
    const repoRoot = requireString(obj, "repoRoot", id);
    if (!repoRoot.ok) return repoRoot;
    const path = requireString(obj, "path", id);
    if (!path.ok) return path;
    if (obj.mode !== "-" && obj.mode !== "+") {
      return invalidPayload("git.diff.open requires payload.mode");
    }
    if (
      obj.originalPath !== undefined &&
      obj.originalPath !== null &&
      typeof obj.originalPath !== "string"
    ) {
      return invalidPayload("git.diff.open requires payload.originalPath");
    }
    if (obj.title !== undefined && typeof obj.title !== "string") {
      return invalidPayload("git.diff.open requires payload.title");
    }
    return {
      ok: true,
      value: {
        id,
        payload: {
          repoRoot: repoRoot.value,
          path: path.value,
          mode: obj.mode,
          originalPath: obj.originalPath as string | null | undefined,
          title: obj.title,
        },
      },
    };
  }

  if (id === "notes.add") {
    const content = requireString(obj, "content", id);
    if (!content.ok) return content;
    return { ok: true, value: { id, payload: { content: content.value } } };
  }

  if (id === "notes.remove") {
    const noteId = requireString(obj, "id", id);
    if (!noteId.ok) return noteId;
    return { ok: true, value: { id, payload: { id: noteId.value } } };
  }

  if (id === "notes.update") {
    const noteId = requireString(obj, "id", id);
    if (!noteId.ok) return noteId;
    const patch: {
      id: string;
      title?: string;
      body?: string;
      url?: string;
      note?: string;
    } = { id: noteId.value };
    for (const key of ["title", "body", "url", "note"] as const) {
      const value = obj[key];
      if (value === undefined) continue;
      if (typeof value !== "string") {
        return invalidPayload(
          `notes.update requires payload.${key} to be a string`,
        );
      }
      patch[key] = value;
    }
    if (
      patch.title === undefined &&
      patch.body === undefined &&
      patch.url === undefined &&
      patch.note === undefined
    ) {
      return invalidPayload(
        "notes.update requires at least one of title, body, url or note",
      );
    }
    return { ok: true, value: { id, payload: patch } };
  }

  if (id === "tasks.openEditor") {
    if (obj.id !== undefined && (typeof obj.id !== "string" || obj.id === "")) {
      return invalidPayload("tasks.openEditor requires payload.id to be a task id");
    }
    return {
      ok: true,
      value: { id, payload: { id: obj.id as string | undefined } },
    };
  }

  if (
    id === "tasks.remove" ||
    id === "tasks.run" ||
    id === "tasks.clone" ||
    id === "tasks.reseed"
  ) {
    const taskId = requireString(obj, "id", id);
    if (!taskId.ok) return taskId;
    return { ok: true, value: { id, payload: { id: taskId.value } } };
  }

  if (id === "tasks.setEnabled") {
    const taskId = requireString(obj, "id", id);
    if (!taskId.ok) return taskId;
    if (typeof obj.enabled !== "boolean") {
      return invalidPayload("tasks.setEnabled requires payload.enabled");
    }
    return {
      ok: true,
      value: { id, payload: { id: taskId.value, enabled: obj.enabled } },
    };
  }

  if (id === "tasks.add" || id === "tasks.update") {
    return validateTaskPayload(id, obj);
  }

  if (id === "tts.start" || id === "tts.install") {
    if (!isTtsEngineId(obj.engine)) {
      return invalidPayload(
        `${id} requires payload.engine to be one of ${TTS_ENGINES.join(", ")}`,
      );
    }
    return { ok: true, value: { id, payload: { engine: obj.engine } } };
  }

  if (id === "tts.stop") {
    if (obj.engine !== undefined && !isTtsEngineId(obj.engine)) {
      return invalidPayload(
        `tts.stop requires payload.engine to be one of ${TTS_ENGINES.join(", ")}`,
      );
    }
    return {
      ok: true,
      value: {
        id,
        payload: { engine: obj.engine as TtsEngineId | undefined },
      },
    };
  }

  if (id === "tts.download") {
    if (!isTtsModelId(obj.model)) {
      return invalidPayload(
        `tts.download requires payload.model to be one of ${TTS_MODELS.join(", ")}`,
      );
    }
    return { ok: true, value: { id, payload: { model: obj.model } } };
  }

  if (id === "tts.speak") {
    const raw = requireString(obj, "text", id);
    if (!raw.ok) return raw;
    const text = raw.value.trim();
    if (text.length === 0) {
      return invalidPayload("tts.speak requires a non-empty payload.text");
    }
    if (text.length > DEFAULT_MAX_TOTAL) {
      return invalidPayload(
        `tts.speak requires payload.text to be at most ${DEFAULT_MAX_TOTAL} characters`,
      );
    }
    if (obj.voiceId !== undefined && typeof obj.voiceId !== "string") {
      return invalidPayload(
        "tts.speak requires payload.voiceId to be a voice profile id",
      );
    }
    if (obj.language !== undefined && !isTtsLanguage(obj.language)) {
      return invalidPayload(
        `tts.speak requires payload.language to be one of ${TTS_LANGUAGES.join(", ")}`,
      );
    }
    return {
      ok: true,
      value: {
        id,
        payload: {
          text,
          voiceId: obj.voiceId as string | undefined,
          language: obj.language as TtsLanguage | undefined,
        },
      },
    };
  }

  if (!validateSettingsTab(obj.tab)) {
    return invalidPayload("settings.open requires payload.tab");
  }
  return { ok: true, value: { id, payload: { tab: obj.tab } } };
}

const TASK_STRING_FIELDS = [
  "cwd",
  "sessionId",
  "model",
  "provider",
  "thinking",
] as const;

function validateTaskPayload(
  id: "tasks.add" | "tasks.update",
  obj: Record<string, unknown>,
): CommandResult<CommandRequest> {
  const out: Record<string, unknown> = {};

  if (id === "tasks.update") {
    const taskId = requireString(obj, "id", id);
    if (!taskId.ok) return taskId;
    out.id = taskId.value;
  }

  for (const key of ["name", "prompt"] as const) {
    if (id === "tasks.add") {
      const value = requireString(obj, key, id);
      if (!value.ok) return value;
      out[key] = value.value;
    } else if (obj[key] !== undefined) {
      if (typeof obj[key] !== "string" || obj[key] === "") {
        return invalidPayload(`${id} requires payload.${key} to be a non-empty string`);
      }
      out[key] = obj[key];
    }
  }

  if (id === "tasks.add" || obj.schedule !== undefined) {
    const spec = requireString(obj, "schedule", id);
    if (!spec.ok) return spec;
    if (parseScheduleSpec(spec.value) === null) {
      return invalidPayload(
        `${id} requires payload.schedule to be a valid schedule spec, for example "every:30m" or "weekly:mon,wed@07:30"`,
      );
    }
    out.schedule = spec.value;
  }

  if (obj.enabled !== undefined) {
    if (id === "tasks.add") {
      return invalidPayload("tasks.add does not accept payload.enabled");
    }
    if (typeof obj.enabled !== "boolean") {
      return invalidPayload("tasks.update requires payload.enabled to be a boolean");
    }
    out.enabled = obj.enabled;
  }

  for (const key of TASK_STRING_FIELDS) {
    const value = obj[key];
    if (value === undefined) continue;
    if (typeof value !== "string" || value === "") {
      return invalidPayload(`${id} requires payload.${key} to be a non-empty string`);
    }
    out[key] = value;
  }

  const enums: readonly [string, readonly string[]][] = [
    ["target", TASK_TARGETS],
    ["mode", TASK_MODES],
    ["agent", TASK_AGENTS],
    ["missed", MISSED_POLICIES],
    ["overlap", OVERLAP_POLICIES],
  ];
  for (const [key, allowed] of enums) {
    const value = obj[key];
    if (value === undefined) continue;
    if (typeof value !== "string" || !allowed.includes(value)) {
      return invalidPayload(
        `${id} requires payload.${key} to be one of ${allowed.join(", ")}`,
      );
    }
    out[key] = value;
  }

  for (const key of ["maxRuns", "tabId"] as const) {
    const value = obj[key];
    if (value === undefined) continue;
    if (!Number.isInteger(value) || (value as number) < 0) {
      return invalidPayload(
        `${id} requires payload.${key} to be a non-negative integer`,
      );
    }
    out[key] = value;
  }

  if (id === "tasks.update" && Object.keys(out).length <= 1) {
    return invalidPayload(
      "tasks.update requires at least one field besides the id",
    );
  }

  return {
    ok: true,
    value: { id, payload: out } as CommandRequest,
  };
}

export function normalizeCommandError(error: unknown): CommandError {
  if (isRecord(error) && typeof error.message === "string") {
    const code =
      typeof error.code === "string" && error.code === "command_failed"
        ? "command_failed"
        : "internal_error";
    return { code, message: error.message };
  }
  if (typeof error === "string" && error.length > 0) {
    return { code: "internal_error", message: error };
  }
  return { code: "internal_error", message: "Command failed" };
}

async function dispatchCommand(
  handlers: CommandHandlers,
  request: CommandRequest,
): Promise<unknown> {
  switch (request.id) {
    case "app.snapshot":
      return handlers.getSnapshot();
    case "app.commands":
      return describeCommands();
    case "app.buildInfo":
      return handlers.getBuildInfo();
    case "app.capture":
      return handlers.capture(request.payload);
    case "sidebar.show":
      return handlers.showSidebar(request.payload);
    case "sidebar.hide":
      return handlers.hideSidebar();
    case "tab.openFile":
      return handlers.openFile(request.payload);
    case "preview.open":
      return handlers.openPreview(request.payload);
    case "mermaid.open":
      return handlers.openMermaid(request.payload);
    case "mermaid.update":
      return handlers.updateMermaid(request.payload);
    case "tab.focus":
      return handlers.focusTab(request.payload);
    case "tab.close":
      return handlers.closeTab(request.payload);
    case "tab.rename":
      return handlers.renameTab(request.payload);
    case "tab.resetTitle":
      return handlers.resetTabTitle(request.payload);
    case "tab.setColor":
      return handlers.setTabColor(request.payload);
    case "git.diff.open":
      return handlers.openGitDiff(request.payload);
    case "git.history.open":
      return handlers.openGitHistory(request.payload);
    case "git.commitFile.open":
      return handlers.openCommitFile(request.payload);
    case "search.content":
      return handlers.searchContent(request.payload);
    case "tab.move":
      return handlers.moveTab(request.payload);
    case "tab.setPinned":
      return handlers.setTabPinned(request.payload);
    case "settings.open":
      return handlers.openSettings(request.payload);
    case "agent-monitor.show":
      return handlers.showAgentMonitor();
    case "agent-monitor.hide":
      return handlers.hideAgentMonitor();
    case "agent-monitor.toggle":
      return handlers.toggleAgentMonitor();
    case "notes.show":
      return handlers.showNotes();
    case "notes.hide":
      return handlers.hideNotes();
    case "notes.toggle":
      return handlers.toggleNotes();
    case "notes.detach":
      return handlers.detachNotes();
    case "notes.attach":
      return handlers.attachNotes();
    case "notes.add":
      return handlers.addNote(request.payload);
    case "notes.remove":
      return handlers.removeNote(request.payload);
    case "notes.update":
      return handlers.updateNote(request.payload);
    case "notes.list":
      return handlers.listNotes();
    case "tasks.show":
      return handlers.showTasks();
    case "tasks.hide":
      return handlers.hideTasks();
    case "tasks.toggle":
      return handlers.toggleTasks();
    case "history.show":
      return handlers.showHistory();
    case "history.hide":
      return handlers.hideHistory();
    case "history.toggle":
      return handlers.toggleHistory();
    case "tasks.openEditor":
      return handlers.openTaskEditor(request.payload);
    case "tasks.list":
      return handlers.listTasks();
    case "tasks.add":
      return handlers.addTask(request.payload);
    case "tasks.update":
      return handlers.updateTask(request.payload);
    case "tasks.clone":
      return handlers.cloneTask(request.payload);
    case "tasks.reseed":
      return handlers.reseedTask(request.payload);
    case "tasks.remove":
      return handlers.removeTask(request.payload);
    case "tasks.run":
      return handlers.runTask(request.payload);
    case "tasks.setEnabled":
      return handlers.setTaskEnabled(request.payload);
    case "tasks.pauseAll":
      return handlers.pauseAllTasks();
    case "tasks.resumeAll":
      return handlers.resumeAllTasks();
    case "tasks.wake":
      return handlers.wakeTasks();
    case "tts.status":
      return handlers.getTtsStatus();
    case "tts.start":
      return handlers.startTtsEngine(request.payload);
    case "tts.stop":
      return handlers.stopTtsEngine(request.payload);
    case "tts.install":
      return handlers.installTtsEngine(request.payload);
    case "tts.download":
      return handlers.downloadTtsModel(request.payload);
    case "tts.voices":
      return handlers.listTtsVoices();
    case "tts.speak":
      return handlers.speakTts(request.payload);
    case "tts.stopSpeaking":
      return handlers.stopTtsSpeaking();
  }
}

export function createCommandRegistry(handlers: CommandHandlers) {
  return {
    async call(input: unknown): Promise<CommandResult> {
      const request = validateCommandRequest(input);
      if (!request.ok) return request;
      try {
        return {
          ok: true,
          value: await dispatchCommand(handlers, request.value),
        };
      } catch (error) {
        return { ok: false, error: normalizeCommandError(error) };
      }
    },
  };
}
