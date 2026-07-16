import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createNativeVisualBackend,
  parseCaptureOutcome,
} from "../src/visual-native.js";
import { validateVisualQaRequest } from "../src/visual.js";

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function outcome(path: string) {
  return {
    target: "window",
    path,
    width: 640,
    height: 400,
    bytes: 8,
    format: "png",
  };
}

describe("parseCaptureOutcome", () => {
  it("accepts a valid outcome", () => {
    const parsed = parseCaptureOutcome(outcome("/tmp/x.png"));
    expect(parsed.width).toBe(640);
    expect(parsed.path).toBe("/tmp/x.png");
  });

  it("rejects malformed outcomes", () => {
    expect(() => parseCaptureOutcome(null)).toThrow();
    expect(() => parseCaptureOutcome({})).toThrow();
    expect(() =>
      parseCaptureOutcome({ ...outcome("/tmp/x.png"), width: -1 }),
    ).toThrow();
    expect(() =>
      parseCaptureOutcome({ ...outcome("/tmp/x.png"), format: "jpeg" }),
    ).toThrow();
    expect(() =>
      parseCaptureOutcome({ ...outcome("/tmp/x.png"), width: 100_000 }),
    ).toThrow();
  });
});

describe("createNativeVisualBackend", () => {
  it("copies the bridge PNG into the evidence path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "terax-native-visual-"));
    try {
      const source = join(dir, "source.png");
      await writeFile(source, PNG_MAGIC);
      const calls: unknown[] = [];
      const backend = createNativeVisualBackend({
        client: {
          call: async (command, payload) => {
            calls.push([command, payload]);
            return outcome(source);
          },
        },
        pid: 4242,
        target: "window",
      });
      const output = join(dir, "evidence.png");
      const descriptor = await backend.capture(
        { pid: 4242, processName: "terax", title: "Terax" },
        output,
      );
      expect(calls).toEqual([["app.capture", { target: "window" }]]);
      expect(descriptor.pid).toBe(4242);
      expect(descriptor.width).toBe(640);
      expect(descriptor.height).toBe(400);
      const copied = await readFile(output);
      expect(copied.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("forwards pane target and tabId", async () => {
    const dir = await mkdtemp(join(tmpdir(), "terax-native-visual-"));
    try {
      const source = join(dir, "source.png");
      await writeFile(source, PNG_MAGIC);
      const calls: unknown[] = [];
      const backend = createNativeVisualBackend({
        client: {
          call: async (command, payload) => {
            calls.push([command, payload]);
            return outcome(source);
          },
        },
        pid: 1,
        target: "pane",
        tabId: 7,
      });
      await backend.capture(
        { pid: 1, processName: "terax", title: "Terax" },
        join(dir, "out.png"),
      );
      expect(calls).toEqual([["app.capture", { target: "pane", tabId: 7 }]]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects a non-png bridge artifact", async () => {
    const dir = await mkdtemp(join(tmpdir(), "terax-native-visual-"));
    try {
      const source = join(dir, "source.png");
      await writeFile(source, Buffer.from("not a png"));
      const backend = createNativeVisualBackend({
        client: { call: async () => outcome(source) },
        pid: 1,
        target: "window",
      });
      await expect(
        backend.capture(
          { pid: 1, processName: "terax", title: "Terax" },
          join(dir, "out.png"),
        ),
      ).rejects.toThrow(/png/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("validateVisualQaRequest native targets", () => {
  it("accepts closed targets on the main surface", () => {
    const request = validateVisualQaRequest({
      action: "screenshot",
      surface: "main",
      name: "capture",
      target: "sidebar",
    });
    expect(request.target).toBe("sidebar");
    const pane = validateVisualQaRequest({
      action: "screenshot",
      surface: "main",
      name: "capture",
      target: "pane",
      tabId: 3,
    });
    expect(pane.tabId).toBe(3);
  });

  it("rejects unknown targets, pane without tabId, and settings targets", () => {
    expect(() =>
      validateVisualQaRequest({
        action: "screenshot",
        surface: "main",
        name: "capture",
        target: "desktop",
      } as never),
    ).toThrow();
    expect(() =>
      validateVisualQaRequest({
        action: "screenshot",
        surface: "main",
        name: "capture",
        target: "pane",
      }),
    ).toThrow();
    expect(() =>
      validateVisualQaRequest({
        action: "screenshot",
        surface: "settings",
        name: "capture",
        target: "sidebar",
      }),
    ).toThrow();
  });
});
