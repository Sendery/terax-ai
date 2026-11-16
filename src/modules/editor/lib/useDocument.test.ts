import { beforeEach, expect, it, vi } from "vitest";
const harness = vi.hoisted(() => ({
  autoSave: false,
  cursor: 0,
  slots: [] as { value: unknown; deps?: unknown[]; cleanup?: () => void }[],
  effects: [] as (() => void)[],
  invoke: vi.fn(),
}));
vi.mock("react", () => ({
  useState(initial: unknown) {
    const index = harness.cursor++;
    if (!harness.slots[index]) harness.slots[index] = { value: initial };
    const slot = harness.slots[index];
    return [
      slot.value,
      (next: unknown) => {
        slot.value = typeof next === "function" ? next(slot.value) : next;
      },
    ];
  },
  useRef(initial: unknown) {
    const index = harness.cursor++;
    if (!harness.slots[index])
      harness.slots[index] = { value: { current: initial } };
    return harness.slots[index].value;
  },
  useCallback(callback: unknown) {
    return callback;
  },
  useEffect(effect: () => undefined | (() => void), deps: unknown[]) {
    const index = harness.cursor++;
    const prior = harness.slots[index];
    if (prior && deps.every((d, i) => Object.is(d, prior.deps?.[i]))) return;
    const slot = { value: null, deps, cleanup: prior?.cleanup };
    harness.slots[index] = slot;
    harness.effects.push(() => {
      slot.cleanup?.();
      slot.cleanup = effect() || undefined;
    });
  },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: harness.invoke }));
vi.mock("@/modules/lsp", () => ({ notifyDocumentSaved: vi.fn() }));
vi.mock("@/modules/workspace", () => ({
  currentWorkspaceEnv: () => ({ kind: "local" }),
}));
vi.mock("@/modules/settings/preferences", () => ({
  usePreferencesStore: (select: (s: unknown) => unknown) =>
    select({ editorAutoSave: harness.autoSave, editorAutoSaveDelay: 1000 }),
}));
import { useDocument } from "@/modules/editor/lib/useDocument";
function TestHarness(path = "/index.html") {
  harness.cursor = 0;
  const doc = useDocument({ path });
  while (harness.effects.length) harness.effects.shift()?.();
  return doc;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
async function load() {
  harness.invoke.mockResolvedValueOnce({
    kind: "text",
    content: "saved",
    size: 5,
  });
  TestHarness();
  await Promise.resolve();
  return TestHarness();
}
beforeEach(() => {
  harness.autoSave = false;
  harness.cursor = 0;
  harness.slots = [];
  harness.effects = [];
  harness.invoke.mockReset();
});
it("publishes the live unsaved buffer without another disk read", async () => {
  const doc = await load();
  doc.onChange("draft");
  expect(TestHarness().doc).toMatchObject({
    status: "ready",
    content: "draft",
  });
  expect(TestHarness().dirty).toBe(true);
  expect(harness.invoke).toHaveBeenCalledTimes(1);
});
it("keeps edits made during a save dirty and saves the latest buffer next", async () => {
  const doc = await load();
  doc.onChange("first");
  const write = deferred<void>();
  harness.invoke.mockReturnValueOnce(write.promise);
  const saving = TestHarness().save();
  TestHarness().onChange("second");
  write.resolve();
  await saving;
  expect(TestHarness().dirty).toBe(true);
  expect(TestHarness().doc).toMatchObject({ content: "second" });
  harness.invoke.mockResolvedValueOnce(undefined);
  await TestHarness().save();
  expect(TestHarness().dirty).toBe(false);
  expect(harness.invoke).toHaveBeenLastCalledWith(
    "fs_write_file",
    expect.objectContaining({ path: "/index.html", content: "second" }),
  );
});
it("rejects a reload that crosses an edit, even when that edit later returns to saved text", async () => {
  const doc = await load();
  const read = deferred<unknown>();
  harness.invoke.mockReturnValueOnce(read.promise);
  doc.reload();
  TestHarness().onChange("draft");
  TestHarness().onChange("saved");
  read.resolve({ kind: "text", content: "stale disk", size: 10 });
  await Promise.resolve();
  expect(TestHarness().doc).toMatchObject({ content: "saved" });
});
it("rejects a delayed reload after the owning path changes", async () => {
  const doc = await load();
  const read = deferred<unknown>();
  harness.invoke.mockReturnValueOnce(read.promise);
  doc.reload();
  harness.invoke.mockResolvedValueOnce({
    kind: "text",
    content: "new owner",
    size: 9,
  });
  TestHarness("/new.html");
  await Promise.resolve();
  read.resolve({ kind: "text", content: "stale", size: 5 });
  await Promise.resolve();
  expect(TestHarness("/new.html").doc).toMatchObject({ content: "new owner" });
});

it("serializes overlapping saves so an older write cannot finish after the newer buffer", async () => {
  const doc = await load();
  doc.onChange("first");
  const first = deferred<void>();
  harness.invoke.mockReturnValueOnce(first.promise);
  const one = TestHarness().save();
  await Promise.resolve();
  await Promise.resolve();
  TestHarness().onChange("second");
  harness.invoke.mockResolvedValueOnce(undefined);
  const two = TestHarness().save();
  await Promise.resolve();
  expect(
    harness.invoke.mock.calls.filter((call) => call[0] === "fs_write_file"),
  ).toHaveLength(1);
  first.resolve();
  await one;
  await two;
  expect(
    harness.invoke.mock.calls
      .filter((call) => call[0] === "fs_write_file")
      .map((call) => call[1].content),
  ).toEqual(["first", "second"]);
  expect(TestHarness().dirty).toBe(false);
});

it("keeps formatting as an unsaved draft and cancels a pending autosave", async () => {
  vi.useFakeTimers();
  try {
    harness.autoSave = true;
    const doc = await load();
    doc.onChange("typing");
    TestHarness().onChange("formatted", { autoSave: false });
    await vi.advanceTimersByTimeAsync(2000);
    expect(harness.invoke).toHaveBeenCalledTimes(1);
    expect(TestHarness().dirty).toBe(true);
    expect(TestHarness().doc).toMatchObject({ content: "formatted" });
    TestHarness().onChange("later typing");
    await vi.advanceTimersByTimeAsync(2000);
    expect(harness.invoke).toHaveBeenLastCalledWith(
      "fs_write_file", expect.objectContaining({ content: "later typing" }),
    );
  } finally { vi.useRealTimers(); }
});
