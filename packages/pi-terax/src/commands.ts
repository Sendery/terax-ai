export const TERAX_COMMAND_IDS = [
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
  "graphx.open",
  "graphx.read",
  "graphx.update",
  "graphx.place",

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
] as const;

export type TeraxCommandId = (typeof TERAX_COMMAND_IDS)[number];

export function isTeraxCommandId(value: unknown): value is TeraxCommandId {
  return (
    typeof value === "string" &&
    TERAX_COMMAND_IDS.includes(value as TeraxCommandId)
  );
}

/**
 * Commands that end up executing shell input. They are offered through
 * `terax_run` only, so a host posture that withholds a shell withholds them
 * by leaving that one tool out.
 */
export const TERAX_SHELL_COMMAND_IDS = [
  "terminal.open",
  "terminal.split",
  "terminal.send",
  "watch.add",
  "watch.update",
  "watch.setEnabled",
  "watch.run",
] as const satisfies readonly TeraxCommandId[];

export type TeraxShellCommandId = (typeof TERAX_SHELL_COMMAND_IDS)[number];

const SHELL_ONLY_WITH_COMMAND: readonly string[] = [
  "terminal.open",
  "terminal.split",
];

export function isTeraxShellCommandId(
  value: unknown,
): value is TeraxShellCommandId {
  return (
    typeof value === "string" &&
    (TERAX_SHELL_COMMAND_IDS as readonly string[]).includes(value)
  );
}

/** Opening or splitting a terminal runs nothing unless it carries a command. */
export function teraxCommandRunsShell(
  command: string,
  payload: unknown,
): boolean {
  if (!isTeraxShellCommandId(command)) return false;
  if (!SHELL_ONLY_WITH_COMMAND.includes(command)) return true;
  return (
    typeof payload === "object" &&
    payload !== null &&
    typeof (payload as { command?: unknown }).command === "string"
  );
}
