import { afterEach, expect, it, vi } from "vitest";
const pending = vi.hoisted(() => {
  let resolve = () => {};
  const gate = new Promise<void>((done) => {
    resolve = done;
  });
  return { gate, resolve, writeText: vi.fn(), readText: vi.fn() };
});
vi.mock("@tauri-apps/plugin-clipboard-manager", async () => {
  await pending.gate;
  return pending;
});
afterEach(() => vi.unstubAllGlobals());
it("revalidates ownership after native import and before any web fallback", async () => {
  const writeText = vi.fn();
  vi.stubGlobal("navigator", { userAgent: "Linux", clipboard: { writeText } });
  const { writeTerminalClipboard } = await import(
    "@/modules/terminal/lib/terminalClipboard"
  );
  let current = true;
  const write = writeTerminalClipboard("retired owner", () => current);
  current = false;
  pending.resolve();
  await write;
  expect(pending.writeText).not.toHaveBeenCalled();
  expect(writeText).not.toHaveBeenCalled();
  current = true;
  pending.writeText.mockImplementationOnce(async () => {
    current = false;
    throw new Error("native write failed");
  });
  await writeTerminalClipboard("failed owner", () => current);
  expect(pending.writeText).toHaveBeenCalledExactlyOnceWith("failed owner");
  expect(writeText).not.toHaveBeenCalled();
});
