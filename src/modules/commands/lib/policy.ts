import type { CommandId } from "./registry";

/**
 * What a command may do, decided once here for every caller.
 *
 * - `read`: returns state and changes nothing the user would notice.
 * - `act`: moves, opens or edits app surfaces; reversible from the UI.
 * - `approve`: runs shell input, starts agents, installs software or deletes
 *   data. The built-in agent asks the user first; MCP marks the tool
 *   destructive; Pi offers shell-capable ones only through `terax_run`.
 *
 * The record is exhaustive on purpose: a new command does not compile until
 * someone decides which of the three it is.
 */
export type CommandPolicy = "read" | "act" | "approve";

export const COMMAND_POLICY: Record<CommandId, CommandPolicy> = {
  "app.snapshot": "read",
  "app.commands": "read",
  "app.buildInfo": "read",
  "app.capture": "read",
  "sidebar.show": "act",
  "sidebar.hide": "act",
  "tab.openFile": "act",
  "preview.open": "act",
  "mermaid.open": "act",
  "mermaid.update": "act",
  "graphx.open": "act",
  "graphx.read": "read",
  "graphx.update": "act",
  "graphx.place": "act",
  "tab.focus": "act",
  "tab.close": "approve",
  "tab.rename": "act",
  "tab.resetTitle": "act",
  "tab.setColor": "act",
  "tab.move": "act",
  "tab.setPinned": "act",
  "git.diff.open": "act",
  "git.history.open": "act",
  "git.commitFile.open": "act",
  "search.content": "read",
  "settings.open": "act",
  "agent-monitor.show": "act",
  "agent-monitor.hide": "act",
  "agent-monitor.toggle": "act",
  "notes.show": "act",
  "notes.hide": "act",
  "notes.toggle": "act",
  "notes.detach": "act",
  "notes.attach": "act",
  "notes.add": "act",
  "notes.remove": "approve",
  "notes.update": "act",
  "notes.list": "read",
  "tasks.show": "act",
  "tasks.hide": "act",
  "tasks.toggle": "act",
  "history.show": "act",
  "history.hide": "act",
  "history.toggle": "act",
  "tasks.openEditor": "act",
  "tasks.list": "read",
  "tasks.add": "approve",
  "tasks.update": "approve",
  "tasks.clone": "approve",
  "tasks.reseed": "approve",
  "tasks.remove": "approve",
  "tasks.run": "approve",
  "tasks.setEnabled": "approve",
  "tasks.pauseAll": "approve",
  "tasks.resumeAll": "approve",
  "tasks.wake": "approve",
  "tts.status": "read",
  "tts.start": "act",
  "tts.stop": "act",
  "tts.install": "approve",
  "tts.download": "approve",
  "tts.voices": "read",
  "tts.speak": "act",
  "tts.stopSpeaking": "act",
  "terminal.list": "read",
  "terminal.read": "read",
  "terminal.open": "approve",
  "terminal.split": "approve",
  "terminal.focus": "act",
  "terminal.close": "approve",
  "terminal.send": "approve",
  "space.list": "read",
  "space.focus": "act",
  "tab.moveToSpace": "act",
  "watch.list": "read",
  "watch.read": "read",
  "watch.add": "approve",
  "watch.update": "approve",
  "watch.remove": "approve",
  "watch.setEnabled": "approve",
  "watch.run": "approve",
  "chat.layout": "act",
  "reader.open": "act",
  "reader.list": "read",
  "reader.state": "read",
  "reader.control": "act",
  "reader.mark": "act",
  "reader.export": "act",
  "reader.dock": "act",
  "reader.delete": "approve",
  "reader.generate": "act",
};

/**
 * Commands that end up executing shell input. A host that denies its agent a
 * shell must deny these too, or the app becomes the way around it.
 */
export const SHELL_COMMAND_IDS = [
  "terminal.open",
  "terminal.split",
  "terminal.send",
  "watch.add",
  "watch.update",
  "watch.setEnabled",
  "watch.run",
] as const satisfies readonly CommandId[];

/** Opening or splitting a terminal runs nothing unless it carries a command. */
const SHELL_ONLY_WITH_COMMAND: ReadonlySet<string> = new Set([
  "terminal.open",
  "terminal.split",
]);

function carriesCommand(payload: unknown): boolean {
  return (
    typeof payload === "object" &&
    payload !== null &&
    typeof (payload as { command?: unknown }).command === "string"
  );
}

export function commandRunsShell(command: string, payload?: unknown): boolean {
  if (!(SHELL_COMMAND_IDS as readonly string[]).includes(command)) return false;
  return !SHELL_ONLY_WITH_COMMAND.has(command) || carriesCommand(payload);
}

/** Whether the built-in agent must ask before running this call. */
export function commandNeedsApproval(command: string, payload?: unknown): boolean {
  if (COMMAND_POLICY[command as CommandId] !== "approve") return false;
  return !SHELL_ONLY_WITH_COMMAND.has(command) || carriesCommand(payload);
}
