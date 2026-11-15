// WebKitGTK can't read external copies, so the native plugin is Linux-only and
// lazy-loaded to keep it out of the mac/win bundle.
const IS_LINUX =
  typeof navigator !== "undefined" &&
  /Linux/.test(navigator.userAgent) &&
  !/Android/.test(navigator.userAgent);

function webClipboard(): Clipboard | null {
  if (typeof navigator === "undefined") return null;
  return navigator.clipboard ?? null;
}

export async function readTerminalClipboard(): Promise<string> {
  if (IS_LINUX) {
    try {
      const { readText } = await import("@tauri-apps/plugin-clipboard-manager");
      return await readText();
    } catch {}
  }
  try {
    return (await webClipboard()?.readText()) ?? "";
  } catch {
    return "";
  }
}

export async function writeTerminalClipboard(text: string): Promise<void> {
  if (IS_LINUX) {
    try {
      const { writeText } = await import(
        "@tauri-apps/plugin-clipboard-manager"
      );
      await writeText(text);
      return;
    } catch {}
  }
  try {
    await webClipboard()?.writeText(text);
  } catch {}
}

/** Called directly by a copy gesture; the payload may arrive from native IPC. */
export function writeDeferredTerminalClipboard(
  read: () => Promise<string>,
  current: () => boolean,
): Promise<void> {
  const text = Promise.resolve()
    .then(read)
    .then((value) => {
      if (!current()) throw new Error("Block output is no longer available.");
      return value;
    });
  // A synchronous clipboard rejection must not orphan a later payload failure.
  void text.catch(() => {});
  if (IS_LINUX) {
    return text.then(async (value) => {
      const { writeText } = await import(
        "@tauri-apps/plugin-clipboard-manager"
      );
      if (!current()) throw new Error("Block output is no longer available.");
      await writeText(value);
    });
  }
  const clipboard = webClipboard();
  if (!clipboard) return Promise.reject(new Error("Clipboard is unavailable."));
  if (
    typeof ClipboardItem !== "undefined" &&
    typeof clipboard.write === "function"
  ) {
    const payload = text.then(
      (value) => new Blob([value], { type: "text/plain" }),
    );
    void payload.catch(() => {});
    try {
      return clipboard.write([new ClipboardItem({ "text/plain": payload })]);
    } catch (error) {
      return Promise.reject(error);
    }
  }
  return text.then((value) => clipboard.writeText(value));
}
