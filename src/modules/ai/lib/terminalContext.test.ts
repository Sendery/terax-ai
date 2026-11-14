import { expect, it, vi } from "vitest";
import {
  readTerminalContext,
  type TerminalTextTarget,
} from "@/modules/ai/lib/terminalContext";

function pendingTarget() {
  let finish!: (text: string) => void;
  const text = new Promise<string>((resolve) => {
    finish = resolve;
  });
  const handle = { getBuffer: vi.fn(() => text) };
  let target: TerminalTextTarget | null = {
    tabId: 1,
    leafId: 2,
    handle,
    private: false,
  };
  return {
    handle,
    finish,
    read: () => target,
    set: (next: TerminalTextTarget | null) => {
      target = next;
    },
  };
}

it("accepts synchronous legacy text and redacts it after validation", async () => {
  const handle = { getBuffer: () => "API_KEY=super-secret-123456789" };
  const text = await readTerminalContext(
    () => ({ tabId: 1, leafId: 2, handle, private: false }),
    300,
  );
  expect(text).not.toContain("super-secret-123456789");
});

it("awaits native text for the same public pane", async () => {
  const target = pendingTarget();
  const result = readTerminalContext(target.read, 300);
  expect(target.handle.getBuffer).toHaveBeenCalledExactlyOnceWith(300);
  target.finish("native history");
  await expect(result).resolves.toBe("native history");
});

for (const change of ["private", "tab", "leaf", "handle", "closed"] as const) {
  it(`discards pending text after the target becomes ${change}`, async () => {
    const target = pendingTarget();
    const result = readTerminalContext(target.read, 300);
    const next = { ...target.read()! };
    if (change === "private") next.private = true;
    if (change === "tab") next.tabId = 3;
    if (change === "leaf") next.leafId = 4;
    if (change === "handle") next.handle = { getBuffer: () => "replacement" };
    target.set(change === "closed" ? null : next);
    target.finish("withheld");
    await expect(result).resolves.toBeNull();
  });
}

it("does not read an initially private pane", async () => {
  const target = pendingTarget();
  target.set({ ...target.read()!, private: true });
  await expect(readTerminalContext(target.read, 300)).resolves.toBeNull();
  expect(target.handle.getBuffer).not.toHaveBeenCalled();
});

it("returns unavailable when the core query fails", async () => {
  const handle = {
    getBuffer: async () => {
      throw new Error("core unavailable");
    },
  };
  await expect(
    readTerminalContext(
      () => ({ tabId: 1, leafId: 2, handle, private: false }),
      300,
    ),
  ).resolves.toBeNull();
});

it("snapshots identity even if the target descriptor is mutated in place", async () => {
  const target = pendingTarget();
  const result = readTerminalContext(target.read, 300);
  target.read()!.leafId = 8;
  target.finish("wrong pane");
  await expect(result).resolves.toBeNull();
});

it("preserves a valid empty terminal so startup polling can continue", async () => {
  const handle = { getBuffer: async () => "" };
  await expect(
    readTerminalContext(
      () => ({ tabId: 1, leafId: 2, handle, private: false }),
      120,
    ),
  ).resolves.toBe("");
});
