import { access, mkdir, mkdtemp, readFile, readdir, rename, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  MAX_CAPTURE_HEIGHT,
  MAX_CAPTURE_PIXELS,
  MAX_CAPTURE_WIDTH,
  MAX_VIDEO_FRAMES,
  assertVisualCaptureSafe,
  buildVideoArgs,
  parseSsim,
  parseWindowDescriptor,
  runVisualQa,
  sanitizeArtifactName,
  surfaceSelector,
  validateVisualQaRequest,
  type VisualBackend,
  type WindowDescriptor,
} from "../src/visual.js";

const windowDescriptor: WindowDescriptor = {
  handle: "0x102A",
  pid: 123,
  processName: "terax",
  title: "Terax",
  x: 10,
  y: 20,
  width: 800,
  height: 600,
};

function backendWithCapture(
  implementation: VisualBackend["capture"] = async (_selector, outputPath) => {
    await writeFile(outputPath, Buffer.from("png-evidence"));
    return windowDescriptor;
  },
): VisualBackend {
  return { capture: vi.fn(implementation), record: vi.fn(), compare: vi.fn() };
}

async function expectMissing(path: string): Promise<void> {
  await expect(access(path)).rejects.toMatchObject({ code: "ENOENT" });
}

describe("Terax visual QA", () => {
  it("sanitizes evidence names and builds an exact authenticated selector", () => {
    expect(sanitizeArtifactName("Settings redesign")).toBe("settings-redesign");
    expect(() => sanitizeArtifactName("../../private")).toThrow(
      "Artifact name contains a path separator",
    );
    expect(surfaceSelector("main", 123)).toEqual({
      pid: 123,
      processName: "terax",
      title: "Terax",
    });
    expect(surfaceSelector("settings", 123)).toEqual({
      pid: 123,
      processName: "terax",
      title: "Settings",
    });
  });

  it("blocks capture while a private terminal is active", () => {
    expect(() =>
      assertVisualCaptureSafe({
        activeTabId: 7,
        tabs: [
          { id: 3, kind: "editor" },
          { id: 7, kind: "private-terminal" },
        ],
      }),
    ).toThrow("Visual QA refuses to capture an active private terminal");
    expect(() =>
      assertVisualCaptureSafe({
        activeTabId: 3,
        tabs: [
          { id: 3, kind: "editor" },
          { id: 7, kind: "private-terminal" },
        ],
      }),
    ).not.toThrow();
  });

  it("parses pid-bound windows and enforces dimension and pixel limits", () => {
    expect(
      parseWindowDescriptor(
        '{"handle":"0x102A","pid":123,"processName":"terax","title":"Terax","x":10,"y":20,"width":800,"height":600}',
      ),
    ).toEqual(windowDescriptor);
    expect(() =>
      parseWindowDescriptor(
        `{"handle":"0x1","pid":123,"processName":"terax","title":"Terax","x":0,"y":0,"width":${MAX_CAPTURE_WIDTH + 1},"height":1}`,
      ),
    ).toThrow("capture limits");
    expect(() =>
      parseWindowDescriptor(
        `{"handle":"0x1","pid":123,"processName":"terax","title":"Terax","x":0,"y":0,"width":${MAX_CAPTURE_WIDTH},"height":${MAX_CAPTURE_HEIGHT}}`,
      ),
    ).toThrow("capture limits");
    expect(MAX_CAPTURE_WIDTH * MAX_CAPTURE_HEIGHT).toBeGreaterThan(
      MAX_CAPTURE_PIXELS,
    );
  });

  it("parses SSIM and bounds video frame plans", () => {
    expect(parseSsim("SSIM Y:0.990 U:0.995 V:0.996 All:0.992341 (21.2)"))
      .toBeCloseTo(0.992341);
    expect(buildVideoArgs("frame-%06d.png", "out.mp4", 15)).toContain(
      "frame-%06d.png",
    );
    expect(MAX_VIDEO_FRAMES).toBeGreaterThanOrEqual(30 * 30);
  });

  it("validates the entire request before capture or evidence writes", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-terax-invalid-"));
    const backend = backendWithCapture();
    await expect(
      runVisualQa(
        {
          action: "compare",
          surface: "main",
          name: "invalid",
          threshold: 2,
        },
        { projectRoot: root, pid: 123, backend, guard: async () => undefined },
      ),
    ).rejects.toThrow("baselinePath is required");
    expect(backend.capture).not.toHaveBeenCalled();
    await expectMissing(join(root, ".terax"));
  });

  it("exports idempotent request validation", () => {
    const first = validateVisualQaRequest({
      action: "video",
      surface: "settings",
      name: "Settings flow",
    });
    expect(validateVisualQaRequest(first)).toEqual(first);
  });

  it("requires an existing regular canonical baseline and rejects escaping symlinks", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-terax-baseline-root-"));
    const outside = await mkdtemp(join(tmpdir(), "pi-terax-baseline-outside-"));
    const outsideFile = join(outside, "outside.png");
    await writeFile(outsideFile, "outside");
    await mkdir(join(root, "visual-baselines"));
    await symlink(outsideFile, join(root, "visual-baselines", "linked.png"));
    const backend = backendWithCapture();

    await expect(
      runVisualQa(
        {
          action: "compare",
          surface: "main",
          name: "escape",
          baselinePath: "visual-baselines/linked.png",
        },
        { projectRoot: root, pid: 123, backend, guard: async () => undefined },
      ),
    ).rejects.toThrow("Baseline must be a regular file inside the trusted project");
    expect(backend.capture).not.toHaveBeenCalled();
    await expectMissing(join(root, ".terax"));
  });

  it("rejects a baseline reached through a directory symlink that escapes", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-terax-baseline-dir-root-"));
    const outside = await mkdtemp(join(tmpdir(), "pi-terax-baseline-dir-outside-"));
    await writeFile(join(outside, "outside.png"), "outside");
    await symlink(outside, join(root, "linked-baselines"));
    const backend = backendWithCapture();

    await expect(
      runVisualQa(
        {
          action: "compare",
          surface: "main",
          name: "directory escape",
          baselinePath: "linked-baselines/outside.png",
        },
        { projectRoot: root, pid: 123, backend, guard: async () => undefined },
      ),
    ).rejects.toThrow("Baseline must be a regular file inside the trusted project");
    expect(backend.capture).not.toHaveBeenCalled();
  });

  it("uses private unpredictable exclusive directories and never reuses a collision", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-terax-unique-"));
    const backend = backendWithCapture();
    const options = {
      projectRoot: root,
      pid: 123,
      backend,
      guard: async () => undefined,
      now: new Date("2026-07-11T12:34:56.000Z"),
    };
    const first = await runVisualQa(
      { action: "screenshot", surface: "main", name: "same" },
      options,
    );
    const second = await runVisualQa(
      { action: "screenshot", surface: "main", name: "same" },
      options,
    );

    expect(first.mediaPath).not.toBe(second.mediaPath);
    expect(first.mediaPath).toMatch(
      /\.terax\/visual-qa\/20260711T123456Z-same-[A-Za-z0-9_-]+\/screenshot\.png$/,
    );
    const report = JSON.parse(await readFile(first.reportPath, "utf8"));
    expect(report.window.pid).toBe(123);
    expect((await readdir(first.reportPath.replace(/\/result\.json$/, ""))).some(
      (entry) => entry.includes(".tmp"),
    )).toBe(false);
  });

  it("removes the entire evidence directory on capture failure", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-terax-cleanup-"));
    const backend = backendWithCapture(async (_selector, outputPath) => {
      await writeFile(outputPath, "partial");
      throw new Error("capture failed");
    });
    await expect(
      runVisualQa(
        { action: "screenshot", surface: "main", name: "failure" },
        { projectRoot: root, pid: 123, backend, guard: async () => undefined },
      ),
    ).rejects.toThrow("capture failed");
    expect(await readdir(join(root, ".terax", "visual-qa"))).toEqual([]);
  });

  it("guards before, throughout, and after video and aborts without partial evidence", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-terax-guard-"));
    let guardCalls = 0;
    const guard = vi.fn(async () => {
      guardCalls += 1;
      if (guardCalls >= 2) {
        throw new Error("Visual QA refuses to capture an active private terminal");
      }
    });
    const record = vi.fn<VisualBackend["record"]>(
      async (_selector, outputPath, _duration, _fps, signal) => {
        await writeFile(outputPath, "partial-video");
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, 2_000);
          signal?.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              reject(new Error("record aborted"));
            },
            { once: true },
          );
        });
        return windowDescriptor;
      },
    );
    const backend: VisualBackend = {
      capture: vi.fn(),
      record,
      compare: vi.fn(),
    };

    await expect(
      runVisualQa(
        {
          action: "video",
          surface: "main",
          name: "guard",
          durationSeconds: 2,
          fps: 1,
        },
        {
          projectRoot: root,
          pid: 123,
          backend,
          guard,
          guardIntervalMs: 5,
        },
      ),
    ).rejects.toThrow("private terminal");
    expect(guard).toHaveBeenCalledTimes(2);
    expect(await readdir(join(root, ".terax", "visual-qa"))).toEqual([]);
  });

  it("compares only after canonical baseline validation", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-terax-compare-"));
    const baseline = join(root, "visual-baselines", "main.png");
    await mkdir(join(root, "visual-baselines"));
    await writeFile(baseline, "baseline");
    const backend = backendWithCapture();
    backend.compare = vi.fn(async () => 0.993);

    const result = await runVisualQa(
      {
        action: "compare",
        surface: "main",
        name: "main baseline",
        baselinePath: "visual-baselines/main.png",
        threshold: 0.99,
      },
      { projectRoot: root, pid: 123, backend, guard: async () => undefined },
    );
    expect(backend.compare).toHaveBeenCalledWith(
      expect.stringMatching(/screenshot\.png$/),
      expect.stringMatching(/\.baseline-snapshot$/),
      expect.any(AbortSignal),
    );
    expect(result).toMatchObject({ baselinePassed: true, score: 0.993 });
    expect(result.baselinePath).toBe(baseline);
    await expectMissing(join(result.reportPath.replace(/\/result\.json$/, ""), ".baseline-snapshot"));
  });

  it("rejects a baseline swapped after validation and before descriptor open", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-terax-baseline-swap-"));
    const baselineDir = join(root, "visual-baselines");
    const baseline = join(baselineDir, "main.png");
    const replacement = join(baselineDir, "replacement.png");
    await mkdir(baselineDir);
    await writeFile(baseline, "approved");
    await writeFile(replacement, "replacement");
    const backend = backendWithCapture();

    await expect(runVisualQa(
      { action: "compare", surface: "main", name: "swap", baselinePath: "visual-baselines/main.png" },
      {
        projectRoot: root,
        pid: 123,
        backend,
        guard: async () => undefined,
        beforeBaselineOpen: async () => rename(replacement, baseline),
      },
    )).rejects.toThrow("Baseline changed before");
    expect(backend.capture).not.toHaveBeenCalled();
  });

  it("revalidates evidence ancestors and keeps POSIX artifacts private", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-terax-evidence-swap-"));
    const backend = backendWithCapture(async (_selector, outputPath) => {
      await writeFile(outputPath, "captured");
      const evidenceRoot = join(root, ".terax", "visual-qa");
      await rename(evidenceRoot, `${evidenceRoot}-old`);
      await mkdir(evidenceRoot, { mode: 0o700 });
      return windowDescriptor;
    });
    await expect(runVisualQa(
      { action: "screenshot", surface: "main", name: "ancestor swap" },
      { projectRoot: root, pid: 123, backend, guard: async () => undefined },
    )).rejects.toThrow("directory or ancestor was replaced");

    const safeRoot = await mkdtemp(join(tmpdir(), "pi-terax-permissions-"));
    const result = await runVisualQa(
      { action: "screenshot", surface: "main", name: "permissions" },
      { projectRoot: safeRoot, pid: 123, backend: backendWithCapture(), guard: async () => undefined },
    );
    if (process.platform !== "win32") {
      expect((await stat(result.reportPath.replace(/\/result\.json$/, ""))).mode & 0o777).toBe(0o700);
      expect((await stat(result.mediaPath)).mode & 0o777).toBe(0o600);
      expect((await stat(result.reportPath)).mode & 0o777).toBe(0o600);
    }
  });
});
