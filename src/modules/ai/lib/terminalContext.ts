import { redactSensitive } from "@/modules/ai/lib/redact";

export type TerminalTextTarget = {
  tabId: number;
  leafId: number;
  private: boolean;
  handle: {
    getBuffer: (maxLines?: number) => string | null | Promise<string | null>;
  };
};

/** Queries cannot carry text across a pane, handle or privacy change. */
export async function readTerminalContext(
  readTarget: () => TerminalTextTarget | null,
  maxLines: number,
): Promise<string | null> {
  const initial = readTarget();
  if (!initial || initial.private) return null;
  const { tabId, leafId, handle } = initial;
  let text: string | null;
  try {
    text = await handle.getBuffer(maxLines);
  } catch {
    return null;
  }
  const current = readTarget();
  if (
    !current ||
    current.private ||
    current.tabId !== tabId ||
    current.leafId !== leafId ||
    current.handle !== handle
  )
    return null;
  return typeof text === "string" ? redactSensitive(text) : null;
}
