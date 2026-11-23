import {
  type CommandId,
  type CommandParamSchema,
  describeCommands,
} from "./registry";

/**
 * The Terax MCP surface: the command registry regrouped into a few
 * outcome-oriented tools for agents that speak MCP (Claude Code, Codex,
 * Cursor, OpenCode). The Rust server (`terax --mcp`) is data-driven from the
 * manifest this module generates, so the registry stays the single place a
 * command is defined; tests fail until a new command is placed in a group,
 * the manifest is regenerated, and every Pi-Terax tool has a counterpart here
 * or a stated reason not to.
 *
 * Design rules (FastMCP guidance): outcomes over operations, flat arguments
 * with closed enums, every string written as agent context, few tools (one
 * server, one job), honest annotations, recoverable errors as results.
 */

type LocalActionId = "status" | "wait";

type ActionSpec =
  | { command: CommandId; summary: string }
  | { local: LocalActionId; summary: string; params: CommandParamSchema[] };

type Annotations = {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
};

type GroupSpec = {
  name: string;
  title: string;
  purpose: string;
  annotations: Annotations;
  actions: Record<string, ActionSpec>;
  /** One wording for an argument several actions share, where the
   *  per-command descriptions would only repeat each other. */
  argDescriptions?: Record<string, string>;
};

const WAIT_PARAM: CommandParamSchema = {
  name: "ms",
  type: "integer",
  required: true,
  description: "Milliseconds to wait, 0 to 30000.",
};

export const MCP_GROUPS: readonly GroupSpec[] = [
  {
    name: "terax_inspect",
    title: "Inspect Terax",
    purpose:
      "Read the running Terax app without changing it: window layout, tabs, spaces, terminal panes and their scrollback, notes, scheduled tasks, watches, speech, the command catalog, file content search and PNG captures of a surface. Private terminals are never listed or read.",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    actions: {
      read_graphx: {
        command: "graphx.read",
        summary: "Read a GraphX document source and revision explicitly.",
      },
      status: {
        local: "status",
        summary:
          "Whether a Terax instance is reachable from this server, and which one. Call it first when another call fails to connect.",
        params: [],
      },
      snapshot: {
        command: "app.snapshot",
        summary:
          "Redacted window state: active space and tab, every tab (id, kind, title, cwd), sidebar, scheduled tasks and speech status. Tab ids from here feed the other tools.",
      },
      list_commands: {
        command: "app.commands",
        summary: "The full registry catalog with every argument, type and enum value.",
      },
      build_info: {
        command: "app.buildInfo",
        summary: "Repository, branch, commit and channel of the running binary.",
      },
      list_terminals: {
        command: "terminal.list",
        summary:
          "Every terminal pane that is not private: pane id (leafId), tab, space, directory, focus and the coding agent running in it.",
      },
      read_terminal: {
        command: "terminal.read",
        summary: "Tail of one terminal pane's scrollback, secrets redacted.",
      },
      list_spaces: {
        command: "space.list",
        summary: "Spaces (named groups of tabs) and which one is active.",
      },
      list_watches: {
        command: "watch.list",
        summary: "Watches with their command, interval, state and last change.",
      },
      read_watch: {
        command: "watch.read",
        summary: "One watch with the output of its last run.",
      },
      list_notes: { command: "notes.list", summary: "Note cards on the active tab." },
      list_tasks: {
        command: "tasks.list",
        summary: "Scheduled tasks with their prompts and schedules.",
      },
      speech_status: {
        command: "tts.status",
        summary: "Installed and running speech engines and downloaded models.",
      },
      list_voices: { command: "tts.voices", summary: "Every voice (profiles and presets), with readiness, for speak." },
      dictation_status: {
        command: "dictation.status",
        summary: "Local dictation: provider, engine, model, install jobs, style and memory tiers.",
      },
      list_reader_documents: {
        command: "reader.list",
        summary: "Documents in the Reader library and where reading stopped.",
      },
      reader_state: {
        command: "reader.state",
        summary: "A Reader document's position, word, timing, speed and cut points.",
      },
      search_content: {
        command: "search.content",
        summary: "Ripgrep content search under a root; secret paths are never returned.",
      },
      capture: {
        command: "app.capture",
        summary:
          "Rasterize a Terax surface to a PNG in the app cache and return its path. Refused while a private terminal is in scope.",
      },
      wait: {
        local: "wait",
        summary: "Pause before reading state again, for UI changes that settle asynchronously.",
        params: [WAIT_PARAM],
      },
    },
  },
  {
    name: "terax_open_view",
    title: "Open views in Terax",
    purpose:
      "Put something in front of the user in a Terax tab: a file in the editor, a local web preview, a Mermaid diagram, a git diff, the commit graph or a file at a commit. An existing tab for the same target is focused instead of duplicated where the command supports it.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    argDescriptions: {
      path: "open_file: absolute or workspace path. Git actions: path relative to repoRoot.",
      title: "Optional custom tab title (80 characters max for Mermaid tabs).",
      source:
        "Mermaid source for Mermaid actions; JSON text for GraphX actions (48 KiB max).",
      originalPath: "Previous path when the file was renamed.",
    },
    actions: {
      open_file: { command: "tab.openFile", summary: "Open a file in an editor tab." },
      open_preview: {
        command: "preview.open",
        summary:
          "Open a loopback URL (localhost, 127.0.0.1, [::1]) in a preview tab.",
      },
      open_graphx: {
        command: "graphx.open",
        summary: "Create or reopen a stable offline GraphX document from JSON.",
      },
      update_graphx: {
        command: "graphx.update",
        summary: "Update the same GraphX document using its expected revision.",
      },
      place_graphx: {
        command: "graphx.place",
        summary:
          "Dock GraphX beside a terminal, float it or return it to its tab.",
      },
      open_mermaid: {
        command: "mermaid.open",
        summary: "Open Mermaid source (48 KiB max) in a new diagram tab.",
      },
      update_mermaid: {
        command: "mermaid.update",
        summary: "Replace the source of an existing Mermaid tab.",
      },
      open_git_diff: {
        command: "git.diff.open",
        summary: "Open the working-tree (+) or staged (-) diff of one file.",
      },
      open_git_history: {
        command: "git.history.open",
        summary: "Open the commit graph of a repository.",
      },
      open_commit_file: {
        command: "git.commitFile.open",
        summary: "Open one file as changed by one commit.",
      },
    },
  },
  {
    name: "terax_manage_tabs",
    title: "Manage Terax tabs",
    purpose:
      "Arrange existing tabs and spaces: focus, rename, colour, reorder, pin or close tabs, move a tab to another space, switch space. Read tab ids with terax_inspect snapshot and space ids with terax_inspect list_spaces first. close_tab removes a tab; everything else is reversible.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    argDescriptions: {
      tabId: "Id of the tab, from terax_inspect snapshot. close_tab closes the active tab when omitted; pin_tab needs an editor tab.",
    },
    actions: {
      focus_tab: { command: "tab.focus", summary: "Make a tab active." },
      close_tab: {
        command: "tab.close",
        summary: "Close a tab, or the active one when tabId is omitted.",
      },
      rename_tab: { command: "tab.rename", summary: "Set a custom tab title." },
      reset_tab_title: {
        command: "tab.resetTitle",
        summary: "Drop the custom title so the tab follows its content again.",
      },
      set_tab_color: { command: "tab.setColor", summary: "Set or clear a tab's accent colour." },
      move_tab: { command: "tab.move", summary: "Move a tab to an index within its space." },
      pin_tab: { command: "tab.setPinned", summary: "Pin or unpin an editor tab." },
      move_tab_to_space: {
        command: "tab.moveToSpace",
        summary: "Move a tab to another space.",
      },
      focus_space: { command: "space.focus", summary: "Switch to a space." },
    },
  },
  {
    name: "terax_terminals",
    title: "Drive Terax terminals",
    purpose:
      "Open, split, focus and close terminal panes, and type into them. Typing runs whatever is at the prompt with the user's permissions, so confirm intent before sending commands that change anything. Read pane ids with terax_inspect list_terminals and their output with terax_inspect read_terminal. Private terminals are refused.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    argDescriptions: {
      leafId: "Id of the terminal pane, from terax_inspect list_terminals.",
      command:
        "Optional one-line command typed and submitted in the new pane once its shell is ready.",
    },
    actions: {
      open_terminal: {
        command: "terminal.open",
        summary: "Open a terminal tab, optionally running a command in it.",
      },
      split_terminal: {
        command: "terminal.split",
        summary: "Split a pane to the right or down; a tab holds four panes at most.",
      },
      focus_terminal: {
        command: "terminal.focus",
        summary: "Focus a pane, switching space and tab as needed.",
      },
      close_terminal: {
        command: "terminal.close",
        summary: "Close a pane and end its shell.",
      },
      send_to_terminal: {
        command: "terminal.send",
        summary:
          "Type one line into a pane. Pass sourceLeafId for an explicit Agent Flow relay; submit false leaves the line at the prompt.",
      },
    },
  },
  {
    name: "terax_watch",
    title: "Watch commands from Terax",
    purpose:
      "Follow something that changes on its own (a pull request, a deploy, a build) without spending agent turns: a watch polls a shell command on an interval and reports when its output changes, by notification or by handing the new output to the Terax AI chat so it can refresh a panel, a GraphX diagram or a note. The command runs unattended with the user's permissions, so confirm it with the user. Read watches with terax_inspect list_watches.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    argDescriptions: {
      id: "Id of the watch, from terax_inspect list_watches.",
    },
    actions: {
      add_watch: { command: "watch.add", summary: "Start a watch." },
      update_watch: { command: "watch.update", summary: "Edit a watch." },
      remove_watch: { command: "watch.remove", summary: "Stop and delete a watch." },
      set_watch_enabled: {
        command: "watch.setEnabled",
        summary: "Pause or resume a watch.",
      },
      run_watch: { command: "watch.run", summary: "Run a watch now." },
    },
  },
  {
    name: "terax_manage_panels",
    title: "Show and hide Terax panels",
    purpose:
      "Show, hide or toggle the side panels (file sidebar, notes, scheduled tasks, session history, agent monitor), float or dock the notes panel, and open the settings window or the task editor for the user.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    actions: {
      show_sidebar: { command: "sidebar.show", summary: "Show the sidebar, optionally on a view." },
      hide_sidebar: { command: "sidebar.hide", summary: "Hide the sidebar." },
      show_notes: { command: "notes.show", summary: "Show the notes panel." },
      hide_notes: { command: "notes.hide", summary: "Hide the notes panel." },
      toggle_notes: { command: "notes.toggle", summary: "Toggle the notes panel." },
      detach_notes: { command: "notes.detach", summary: "Float notes in their own window." },
      attach_notes: { command: "notes.attach", summary: "Dock floating notes back." },
      show_tasks: { command: "tasks.show", summary: "Show the scheduled tasks panel." },
      hide_tasks: { command: "tasks.hide", summary: "Hide the scheduled tasks panel." },
      toggle_tasks: { command: "tasks.toggle", summary: "Toggle the scheduled tasks panel." },
      show_history: { command: "history.show", summary: "Show the session history graph." },
      hide_history: { command: "history.hide", summary: "Hide the session history graph." },
      toggle_history: { command: "history.toggle", summary: "Toggle the session history graph." },
      show_agent_monitor: { command: "agent-monitor.show", summary: "Show the agent monitor." },
      hide_agent_monitor: { command: "agent-monitor.hide", summary: "Hide the agent monitor." },
      toggle_agent_monitor: {
        command: "agent-monitor.toggle",
        summary: "Toggle the agent monitor.",
      },
      set_chat_layout: {
        command: "chat.layout",
        summary: "Float the Terax AI chat, dock it left or right, or put it above the bottom bar.",
      },
      open_settings: { command: "settings.open", summary: "Open the settings window." },
      open_task_editor: {
        command: "tasks.openEditor",
        summary: "Open the task editor so the user can review or finish a task.",
      },
    },
  },
  {
    name: "terax_manage_notes",
    title: "Manage Terax notes",
    purpose:
      "Add, edit or remove note cards on the active tab. Read them with terax_inspect list_notes. remove_note deletes a note.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    argDescriptions: {
      id: "Id of the note card, from terax_inspect list_notes.",
    },
    actions: {
      add_note: {
        command: "notes.add",
        summary: "Add a note; a URL becomes a link card, other text a plain note.",
      },
      update_note: { command: "notes.update", summary: "Edit fields of a note." },
      remove_note: { command: "notes.remove", summary: "Delete a note." },
    },
  },
  {
    name: "terax_schedule_tasks",
    title: "Schedule Terax agent tasks",
    purpose:
      "Create and drive scheduled tasks: stored prompts Terax hands to a coding agent (pi, claude or codex) on a schedule or on demand. Running a task starts an agent with its own permissions, so confirm intent with the user first. Read tasks with terax_inspect list_tasks.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    argDescriptions: {
      id: "Id of the task, from terax_inspect list_tasks.",
      name: "Short label shown on the task card.",
      prompt: "Prompt the agent receives. Multiple lines are allowed.",
      enabled: "True to schedule the task, false to stop it.",
    },
    actions: {
      add_task: { command: "tasks.add", summary: "Create a task." },
      update_task: { command: "tasks.update", summary: "Edit a task." },
      clone_task: { command: "tasks.clone", summary: "Duplicate a task; the copy starts disabled." },
      reseed_task: {
        command: "tasks.reseed",
        summary: "Give a task a fresh agent session so its context starts clean.",
      },
      remove_task: { command: "tasks.remove", summary: "Delete a task." },
      run_task: { command: "tasks.run", summary: "Run a task now." },
      set_task_enabled: { command: "tasks.setEnabled", summary: "Enable or disable a task." },
      pause_all: { command: "tasks.pauseAll", summary: "Pause the whole scheduler." },
      resume_all: { command: "tasks.resumeAll", summary: "Resume the scheduler." },
      wake: {
        command: "tasks.wake",
        summary: "Re-evaluate the schedule now and dispatch anything due.",
      },
    },
  },
  {
    name: "terax_speak",
    title: "Speak through Terax",
    purpose:
      "Read short text aloud on the user's machine with Terax's local speech engines, manage those engines, and run the Reader: a read-along view for long texts, docked as a panel under the tab on screen or in a tab of its own, with word highlighting, bookmarks, scripted pauses, audio export and a library of past readings. Use speech for confirmations and requested summaries, never for logs. Engine installs and model downloads fetch from the network; delete_reader_documents deletes readings and their audio.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    argDescriptions: {
      engine: "Speech engine. stop_engine stops every running engine when omitted.",
    },
    actions: {
      speak: {
        command: "tts.speak",
        summary: "Speak plain prose; returns once playback starts.",
      },
      stop_speaking: { command: "tts.stopSpeaking", summary: "Stop playback and drop the queue." },
      start_engine: { command: "tts.start", summary: "Start a speech engine." },
      stop_engine: { command: "tts.stop", summary: "Stop one engine, or all when omitted." },
      install_engine: { command: "tts.install", summary: "Install a speech engine and its default model." },
      download_model: { command: "tts.download", summary: "Download a speech model." },
      install_dictation: {
        command: "dictation.install",
        summary: "Install the local dictation engine (Rumble-2-Flash, about 1 GB) and its model.",
      },
      start_dictation: { command: "dictation.start", summary: "Start the local dictation engine." },
      stop_dictation: { command: "dictation.stop", summary: "Stop the local dictation engine." },
      transcribe_audio: {
        command: "dictation.transcribe",
        summary:
          "Transcribe an audio file on this machine with the local dictation engine and the user's dictionary and style.",
      },
      open_reader: {
        command: "reader.open",
        summary:
          "Open a text or file in the Reader panel under a tab (or a Reader tab), optionally playing it.",
      },
      dock_reader: {
        command: "reader.dock",
        summary: "Show a reading or the library in the Reader panel under a tab, or close it.",
      },
      delete_reader_documents: {
        command: "reader.delete",
        summary: "Delete one reading, or all of them, with their audio.",
      },
      control_reader: {
        command: "reader.control",
        summary: "Play, pause, stop, step, seek or change the speed of a Reader document.",
      },
      mark_reader: {
        command: "reader.mark",
        summary: "Place or remove a bookmark, scripted pause or stop before a word.",
      },
      export_reader: {
        command: "reader.export",
        summary:
          "Start exporting a reading as one WAV, or as one WAV per section, paragraph or sentence; poll reader_state.",
      },
      generate_reading: {
        command: "reader.generate",
        summary:
          "Generate audio fragments of a text, file or reading in the background (paragraph, heading, sentence or one file); poll reader_state.",
      },
    },
  },
];

/**
 * How each Pi-Terax extension tool is served over MCP. A new extension tool
 * fails the alignment test until it is listed here, either pointing at the
 * MCP action that covers it or with the reason it stays Pi-only.
 */
export const EXTENSION_TOOL_ALIGNMENT: Record<
  string,
  { mcp: { tool: string; action?: string } } | { piOnly: string }
> = {
  terax_status: { mcp: { tool: "terax_inspect", action: "status" } },
  terax_get_state: { mcp: { tool: "terax_inspect", action: "snapshot" } },
  terax_call: { mcp: { tool: "*" } },
  terax_run: { mcp: { tool: "*" } },
  terax_wait: { mcp: { tool: "terax_inspect", action: "wait" } },
  // Every action, under the same names: see TERAX_SPEAK_ACTIONS in the extension.
  terax_speak: { mcp: { tool: "terax_speak" } },
  terax_development_guide: {
    piOnly:
      "Guides Pi's own development workflow and ships with the extension's skills.",
  },
  terax_visual_qa: {
    piOnly:
      "Video recording and baseline comparison run on Pi's Node capture pipeline; MCP clients get stills through terax_inspect capture.",
  },
};

const MCP_SERVER_INSTRUCTIONS =
  "Controls the running Terax terminal app. Start with terax_inspect (action snapshot) to learn tab ids and what is open, then act with the other tools; every tool takes an `action` plus flat arguments listed in its description. Terminal panes are listed and read through terax_inspect and driven through terax_terminals; private terminals are never exposed. When a call fails to connect, call terax_inspect with action status: Terax must be running for this server to reach it.";

type JsonSchema = Record<string, unknown>;

function paramSchema(param: CommandParamSchema): JsonSchema {
  const base: JsonSchema =
    param.type === "enum"
      ? { type: "string", enum: [...(param.values ?? [])] }
      : { type: param.type };
  if (!param.nullable) return base;
  return {
    ...base,
    type: [base.type as string, "null"],
    ...(base.enum ? { enum: [...(base.enum as string[]), null] } : {}),
  };
}

function sameShape(a: CommandParamSchema, b: CommandParamSchema): boolean {
  return (
    a.type === b.type &&
    Boolean(a.nullable) === Boolean(b.nullable) &&
    JSON.stringify(a.values ?? []) === JSON.stringify(b.values ?? [])
  );
}

type McpSurfaceAction =
  | { command: CommandId; params: string[] }
  | { local: LocalActionId; params: string[] };

type McpSurfaceTool = {
  name: string;
  title: string;
  description: string;
  annotations: Annotations & { title: string };
  inputSchema: JsonSchema;
  actions: Record<string, McpSurfaceAction>;
};

export type McpSurface = {
  version: 1;
  server: { name: string; title: string; instructions: string };
  tools: McpSurfaceTool[];
};

function describeAction(name: string, summary: string, params: CommandParamSchema[]) {
  const args = params.map((p) => (p.required ? p.name : `${p.name}?`)).join(", ");
  return `- ${name}(${args}): ${summary}`;
}

/** Build the manifest the Rust server embeds. Throws when a group would put
 *  two different shapes under one argument name, because a flat schema can
 *  only describe one. */
export function buildMcpSurface(): McpSurface {
  const catalog = new Map(describeCommands().commands.map((c) => [c.id, c]));
  const tools = MCP_GROUPS.map((group): McpSurfaceTool => {
    const params = new Map<
      string,
      { schema: CommandParamSchema; texts: Map<string, string[]> }
    >();
    const lines: string[] = [];
    const actions: Record<string, McpSurfaceAction> = {};

    for (const [actionName, spec] of Object.entries(group.actions)) {
      const actionParams =
        "command" in spec ? [...(catalog.get(spec.command)?.params ?? [])] : spec.params;
      if ("command" in spec && !catalog.has(spec.command)) {
        throw new Error(`${group.name}.${actionName}: unknown command ${spec.command}`);
      }
      for (const p of actionParams) {
        const seen = params.get(p.name);
        if (seen && !sameShape(seen.schema, p)) {
          throw new Error(`${group.name}: argument ${p.name} has two shapes`);
        }
        const entry = seen ?? { schema: p, texts: new Map<string, string[]>() };
        const users = entry.texts.get(p.description) ?? [];
        users.push(actionName);
        entry.texts.set(p.description, users);
        params.set(p.name, entry);
      }
      lines.push(describeAction(actionName, spec.summary, actionParams));
      actions[actionName] =
        "command" in spec
          ? { command: spec.command, params: actionParams.map((p) => p.name) }
          : { local: spec.local, params: actionParams.map((p) => p.name) };
    }

    const properties: Record<string, JsonSchema> = {
      action: {
        type: "string",
        enum: Object.keys(group.actions),
        description: "What to do. Each action's arguments are listed in the tool description; ? marks optional ones.",
      },
    };
    for (const [name, { schema, texts }] of params) {
      const description =
        group.argDescriptions?.[name] ??
        (texts.size === 1
          ? [...texts.keys()][0]
          : [...texts].map(([text, users]) => `${users.join(", ")}: ${text}`).join(" "));
      properties[name] = { ...paramSchema(schema), description };
    }

    return {
      name: group.name,
      title: group.title,
      description: `${group.purpose}\n\nActions:\n${lines.join("\n")}`,
      annotations: { title: group.title, ...group.annotations },
      inputSchema: {
        type: "object",
        properties,
        required: ["action"],
        additionalProperties: false,
      },
      actions,
    };
  });

  return {
    version: 1,
    server: { name: "terax", title: "Terax", instructions: MCP_SERVER_INSTRUCTIONS },
    tools,
  };
}
