import { afterEach, describe, expect, it, vi } from "vitest";

const { openUrl } = vi.hoisted(() => ({ openUrl: vi.fn() }));

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));

import {
  createTerminalLinkHandler,
  type LinkRowSource,
  readLinkRow,
} from "./terminalLinks";

function bufferOf(...lines: string[]): LinkRowSource {
  return {
    getLine: (index) =>
      index >= 0 && index < lines.length
        ? { translateToString: () => lines[index] }
        : undefined,
  };
}

describe("readLinkRow", () => {
  it("reads the row xterm asked about, not the one below it", () => {
    const buffer = bufferOf("src/first.ts", "src/second.ts", "src/third.ts");

    // provideLinks numbers rows 1-based; getLine indexes them 0-based.
    expect(readLinkRow(buffer, 1)).toBe("src/first.ts");
    expect(readLinkRow(buffer, 2)).toBe("src/second.ts");
    expect(readLinkRow(buffer, 3)).toBe("src/third.ts");
  });

  it("reads scrolled-back rows, whose number already includes the scroll offset", () => {
    // xterm adds buffer.ydisp before calling, so a viewport showing rows
    // 41-43 of a longer buffer asks about absolute rows 41-43.
    const lines = Array.from({ length: 60 }, (_, i) => `src/file-${i + 1}.ts`);

    expect(readLinkRow(bufferOf(...lines), 41)).toBe("src/file-41.ts");
  });

  it("returns an empty string past the end of the buffer", () => {
    expect(readLinkRow(bufferOf("only.ts"), 2)).toBe("");
  });

  it("reads the last row instead of falling off the end", () => {
    // The previous implementation only landed on the right row here, by way of
    // an out-of-range read falling back one line.
    expect(readLinkRow(bufferOf("first.ts", "last.ts"), 2)).toBe("last.ts");
  });
});

describe("createTerminalLinkHandler", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("opens OSC 8 links natively and restores late-bound terminal focus", async () => {
    openUrl.mockResolvedValue(undefined);
    const initialFocus = vi.fn();
    let focus = initialFocus;
    const handler = createTerminalLinkHandler(() => focus());
    focus = vi.fn();

    handler.activate(
      { button: 0, ctrlKey: false } as MouseEvent,
      "https://chatgpt.com/codex/settings/usage",
    );

    expect(openUrl).toHaveBeenCalledWith(
      "https://chatgpt.com/codex/settings/usage",
    );
    await vi.waitFor(() => expect(focus).toHaveBeenCalledOnce());
    expect(initialFocus).not.toHaveBeenCalled();
  });

  it("leaves a right-clicked OSC 8 link to the context menu", () => {
    const handler = createTerminalLinkHandler(() => {});
    handler.activate(
      { button: 2, ctrlKey: false } as MouseEvent,
      "https://x.dev",
    );
    expect(openUrl).not.toHaveBeenCalled();
  });
});
