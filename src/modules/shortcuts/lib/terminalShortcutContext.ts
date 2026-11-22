type TerminalShortcut = "ai.askSelection" | "sidebar.toggle";

type TerminalShortcutContext = {
  target: EventTarget | null;
  shiftKey: boolean;
  getSelection: () => string | null | undefined;
};

export function shouldYieldTerminalShortcut(
  id: TerminalShortcut,
  { target, shiftKey, getSelection }: TerminalShortcutContext,
): boolean {
  const inTerminal = Boolean(
    (target as Element | null)?.closest?.("[data-native-terminal-grid]"),
  );
  if (!inTerminal) return false;
  return id === "sidebar.toggle" ? !shiftKey : !getSelection()?.trim();
}
