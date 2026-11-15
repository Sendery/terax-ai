import { expect, it, vi } from "vitest";
import { NativeLinkCoordinator } from "@/modules/terminal/gl/nativeLinkCoordinator";
import type { NativeLinkContext } from "@/modules/terminal/gl/nativeLinks";
function context(uri = "https://one.test"): NativeLinkContext {
  return {
    seq: 1,
    cols: 8,
    viewportRows: 2,
    text: "link",
    offset: 1,
    startClipped: false,
    endClipped: false,
    rows: [
      {
        row: 0,
        startCol: 0,
        cells: [
          [0, 1],
          [1, 2],
          [2, 3],
          [3, 4],
        ],
      },
    ],
    osc8: { uri, ranges: [{ row: 0, start: 0, end: 4 }] },
  };
}
function setup() {
  let key = "owner1";
  let seq = 1;
  let active = true;
  const options = {
    lookup: vi.fn(async () => context()),
    origin: () => ({
      key,
      source: {
        cwd: "/repo",
        home: null,
        stat: vi.fn(async () => ({ kind: "file" as const })),
      },
    }),
    active: () => active,
    presentedSeq: () => seq,
    paint: vi.fn(),
    openFile: vi.fn(),
    openUrl: vi.fn(async () => {}),
    focus: vi.fn(),
    isMac: true,
  };
  return {
    options,
    controller: new NativeLinkCoordinator(options),
    setKey: (next: string) => {
      key = next;
    },
    setSeq: (next: number) => {
      seq = next;
    },
    deactivate: () => {
      active = false;
    },
  };
}
const point = { seq: 1, col: 1, row: 0 };
const primary = { button: 0, ctrlKey: false };
it("retains the destination clicked in the drawn frame when later output changes", async () => {
  const h = setup();
  let finish!: (value: NativeLinkContext) => void;
  h.options.lookup.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  h.controller.begin(point);
  const opening = h.controller.end({ ...point, seq: 2 }, primary, false);
  await Promise.resolve();
  h.setSeq(2);
  finish(context());
  await expect(opening).resolves.toBe(true);
  expect(h.options.openUrl).toHaveBeenCalledExactlyOnceWith("https://one.test");
});
it("never activates right clicks, drags, another pane or a replacement owner", async () => {
  for (const [event, dragged, change] of [
    [{ button: 2, ctrlKey: false }, false, false],
    [primary, true, false],
    [{ button: 0, ctrlKey: true }, false, false],
    [primary, false, true],
  ] as const) {
    const h = setup();
    h.controller.begin(point);
    if (change) h.setKey("replacement");
    await expect(h.controller.end(point, event, dragged)).resolves.toBe(false);
    expect(h.options.openUrl).not.toHaveBeenCalled();
  }
});
it("does not paint stale hover results over a later point or after disposal", async () => {
  const h = setup();
  let finish!: (value: NativeLinkContext) => void;
  h.options.lookup.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const first = h.controller.hover(point);
  await Promise.resolve();
  await h.controller.hover({ ...point, col: 2 });
  finish(context("https://stale.test"));
  await first;
  expect(h.options.paint.mock.calls.slice(-1)[0]?.[0]?.target).toEqual({
    kind: "url",
    url: "https://one.test",
  });
  h.controller.dispose();
  expect(h.options.paint.mock.calls.slice(-1)[0]?.[0]).toBeNull();
  h.controller.begin(point);
  await expect(h.controller.end(point, primary, false)).resolves.toBe(false);
});
it("checks the source again after file metadata lookup and leaves editor focus to file open", async () => {
  const h = setup();
  const c = context();
  c.osc8 = null;
  c.text = "file.ts";
  c.rows[0].cells = Array.from({ length: 7 }, (_, i) => [i, i + 1]);
  h.options.lookup.mockResolvedValue(c);
  let finish!: (value: { kind: "file" }) => void;
  const stat = vi.fn(
    () =>
      new Promise<{ kind: "file" }>((resolve) => {
        finish = resolve;
      }),
  );
  h.options.origin = () => ({
    key: "original",
    source: { cwd: "/repo", home: null, stat },
  });
  h.controller.begin(point);
  const opening = h.controller.end(point, primary, false);
  await vi.waitFor(() => expect(stat).toHaveBeenCalled());
  h.options.origin = () => ({
    key: "changed",
    source: { cwd: "/elsewhere", home: null, stat },
  });
  finish({ kind: "file" });
  await expect(opening).resolves.toBe(false);
  expect(h.options.openFile).not.toHaveBeenCalled();
});

it("allows the first click to focus an available pane before activation", async () => {
  const h = setup();
  let focused = false;
  const controller = new NativeLinkCoordinator({
    ...h.options,
    available: () => true,
    active: () => focused,
  });
  await controller.hover(point);
  expect(h.options.paint.mock.calls.slice(-1)[0]?.[0]?.target).toEqual({
    kind: "url",
    url: "https://one.test",
  });
  controller.begin(point);
  focused = true;
  await expect(controller.end(point, primary, false)).resolves.toBe(true);
  expect(h.options.openUrl).toHaveBeenCalledOnce();
});
it("opens a confirmed file through the editor callback without returning focus to the terminal", async () => {
  const h = setup();
  const c = context();
  c.osc8 = null;
  c.text = "file.ts";
  c.rows[0].cells = Array.from({ length: 7 }, (_, i) => [i, i + 1]);
  h.options.lookup.mockResolvedValue(c);
  h.controller.begin(point);
  await expect(h.controller.end(point, primary, false)).resolves.toBe(true);
  expect(h.options.openFile).toHaveBeenCalledWith("/repo/file.ts", undefined);
  expect(h.options.focus).not.toHaveBeenCalled();
});
