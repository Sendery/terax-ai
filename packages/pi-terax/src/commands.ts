export const TERAX_COMMAND_IDS = [
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
  "tasks.show",
  "tasks.hide",
  "tasks.toggle",
  "tasks.openEditor",
  "tasks.list",
  "tasks.add",
  "tasks.update",
  "tasks.remove",
  "tasks.run",
  "tasks.setEnabled",
  "tasks.pauseAll",
  "tasks.resumeAll",
  "tasks.wake",
] as const;

export type TeraxCommandId = (typeof TERAX_COMMAND_IDS)[number];

export function isTeraxCommandId(value: unknown): value is TeraxCommandId {
  return (
    typeof value === "string" &&
    TERAX_COMMAND_IDS.includes(value as TeraxCommandId)
  );
}
