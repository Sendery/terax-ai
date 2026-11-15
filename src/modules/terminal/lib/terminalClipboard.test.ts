import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  readText: vi.fn<() => Promise<string>>(),
  writeText: vi.fn<(t: string) => Promise<void>>(),
}));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => native);

const web = {
  readText: vi.fn<() => Promise<string>>(),
  writeText: vi.fn<(t: string) => Promise<void>>(),
};

const original = globalThis.navigator;
const LINUX = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15";
const MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15";

function platform(userAgent: string) {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { userAgent, clipboard: web },
  });
}

async function load() {
  vi.resetModules();
  return import("./terminalClipboard");
}

describe("terminalClipboard", () => {
  beforeEach(() => {
    native.readText.mockReset();
    native.writeText.mockReset();
    web.readText.mockReset();
    web.writeText.mockReset();
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: original,
    });
  });

  it("reads the native clipboard first on Linux", async () => {
    platform(LINUX);
    native.readText.mockResolvedValue("native");
    web.readText.mockResolvedValue("web");
    const { readTerminalClipboard } = await load();
    await expect(readTerminalClipboard()).resolves.toBe("native");
    expect(web.readText).not.toHaveBeenCalled();
  });

  it("falls back to the web clipboard when the native read fails", async () => {
    platform(LINUX);
    native.readText.mockRejectedValue(new Error("no ipc"));
    web.readText.mockResolvedValue("web");
    const { readTerminalClipboard } = await load();
    await expect(readTerminalClipboard()).resolves.toBe("web");
  });

  it("never touches the native clipboard off Linux", async () => {
    platform(MAC);
    web.readText.mockResolvedValue("web");
    const { readTerminalClipboard, writeTerminalClipboard } = await load();
    await expect(readTerminalClipboard()).resolves.toBe("web");
    await writeTerminalClipboard("x");
    expect(native.readText).not.toHaveBeenCalled();
    expect(native.writeText).not.toHaveBeenCalled();
    expect(web.writeText).toHaveBeenCalledWith("x");
  });

  it("writes the native clipboard first on Linux", async () => {
    platform(LINUX);
    native.writeText.mockResolvedValue();
    const { writeTerminalClipboard } = await load();
    await writeTerminalClipboard("copied");
    expect(native.writeText).toHaveBeenCalledWith("copied");
    expect(web.writeText).not.toHaveBeenCalled();
  });
});

describe("deferred terminal clipboard output", () => {
  beforeEach(() => {
    native.readText.mockReset();
    native.writeText.mockReset();
    web.readText.mockReset();
    web.writeText.mockReset();
    Reflect.deleteProperty(web, "write");
  });
  afterEach(() => vi.unstubAllGlobals());
  it("starts the clipboard write in the gesture before delayed output resolves", async () => {
    platform(MAC);
    let resolve!: (value: string) => void;
    const data = new Promise<string>((r) => {
      resolve = r;
    });
    let payload!: Promise<Blob>;
    vi.stubGlobal(
      "ClipboardItem",
      class {
        constructor(value: Record<string, Promise<Blob>>) {
          payload = value["text/plain"];
        }
      },
    );
    const write = vi.fn(async () => {
      await payload;
    });
    Object.assign(web, { write });
    const { writeDeferredTerminalClipboard } = await load();
    const pending = writeDeferredTerminalClipboard(
      () => data,
      () => true,
    );
    expect(write).toHaveBeenCalledOnce();
    resolve("native output");
    await pending;
    expect(await (await payload).text()).toBe("native output");
    expect(native.writeText).not.toHaveBeenCalled();
    Reflect.deleteProperty(web, "write");
  });
  it("rejects a stale output without supplying clipboard text", async () => {
    platform(MAC);
    let resolve!: (value: string) => void;
    let current = true;
    let payload!: Promise<Blob>;
    vi.stubGlobal(
      "ClipboardItem",
      class {
        constructor(value: Record<string, Promise<Blob>>) {
          payload = value["text/plain"];
        }
      },
    );
    const write = vi.fn(async () => {
      await payload;
    });
    Object.assign(web, { write });
    const { writeDeferredTerminalClipboard } = await load();
    const pending = writeDeferredTerminalClipboard(
      () =>
        new Promise<string>((r) => {
          resolve = r;
        }),
      () => current,
    );
    const rejected = expect(pending).rejects.toThrow("available");
    await Promise.resolve();
    current = false;
    resolve("old output");
    await rejected;
    Reflect.deleteProperty(web, "write");
  });
  it("reports a rejected clipboard write instead of claiming success", async () => {
    platform(MAC);
    const { writeDeferredTerminalClipboard } = await load();
    web.writeText.mockRejectedValue(new Error("write denied"));
    await expect(
      writeDeferredTerminalClipboard(
        async () => "output",
        () => true,
      ),
    ).rejects.toThrow("write denied");
  });
});
