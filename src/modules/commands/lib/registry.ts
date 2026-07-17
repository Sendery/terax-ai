import {
  CAPTURE_TARGETS,
  type CaptureOutcome,
  type CaptureRequest,
  validateCaptureRequest,
} from "@/modules/capture";
import type { SettingsTab } from "@/modules/settings/openSettingsWindow";
import type { SidebarViewId } from "@/modules/sidebar";
import { isTabColor, TAB_COLORS, type TabColor } from "@/modules/tabs";
import type { AppSnapshot } from "./snapshot";

export const COMMAND_IDS = [
  "app.snapshot",
  "app.commands",
  "app.buildInfo",
  "app.capture",
  "sidebar.show",
  "sidebar.hide",
  "tab.openFile",
  "tab.focus",
  "tab.close",
  "tab.rename",
  "tab.resetTitle",
  "tab.setColor",
  "git.diff.open",
  "settings.open",
  "notes.show",
  "notes.hide",
  "notes.toggle",
  "notes.detach",
  "notes.attach",
  "notes.add",
  "notes.remove",
  "notes.update",
  "notes.list",
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
  "tab.focus": { tabId: number };
  "tab.close": { tabId?: number };
  "tab.rename": { tabId: number; title: string };
  "tab.resetTitle": { tabId: number };
  "tab.setColor": { tabId: number; color: TabColor | null };
  "git.diff.open": {
    repoRoot: string;
    path: string;
    mode: "-" | "+";
    originalPath?: string | null;
    title?: string;
  };
  "settings.open": { tab?: SettingsTab };
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
  "settings.open": {
    id: "settings.open",
    description: "Open the settings window, optionally on a section.",
    params: [
      {
        name: "tab",
        type: "enum",
        required: false,
        description: "Settings section to deep-link.",
        values: ["general", "models", "agents", "themes", "shortcuts", "about"],
      },
    ],
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
  openSettings: (
    payload: CommandPayloads["settings.open"],
  ) => Promise<unknown> | unknown;
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
    id === "notes.show" ||
    id === "notes.hide" ||
    id === "notes.toggle" ||
    id === "notes.detach" ||
    id === "notes.attach" ||
    id === "notes.list"
  ) {
    if (payload !== undefined && payload !== null) {
      return invalidPayload(`${id} does not accept a payload`);
    }
    return { ok: true, value: { id } as CommandRequest };
  }

  const acceptsEmptyPayload =
    id === "sidebar.show" || id === "tab.close" || id === "settings.open";
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
        return invalidPayload(`notes.update requires payload.${key} to be a string`);
      }
      patch[key] = value;
    }
    if (patch.title === undefined && patch.body === undefined &&
        patch.url === undefined && patch.note === undefined) {
      return invalidPayload(
        "notes.update requires at least one of title, body, url or note",
      );
    }
    return { ok: true, value: { id, payload: patch } };
  }

  if (!validateSettingsTab(obj.tab)) {
    return invalidPayload("settings.open requires payload.tab");
  }
  return { ok: true, value: { id, payload: { tab: obj.tab } } };
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
    case "settings.open":
      return handlers.openSettings(request.payload);
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
