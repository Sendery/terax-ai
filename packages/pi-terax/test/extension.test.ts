import { describe, expect, it, vi } from "vitest";
import extension, { createExtension, type ExtensionDependencies } from "../src/extension.js";
import type { VisualQaResult, WindowDescriptor } from "../src/visual.js";
import { isTeraxCommandId, TERAX_COMMAND_IDS } from "../src/commands.js";

type RegisteredTool = {
  name: string;
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
    onUpdate?: unknown,
    context?: { cwd: string; isProjectTrusted: () => boolean },
  ) => Promise<{
    content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[];
    details: unknown;
  }>;
};

describe("Pi extension", () => {
  const descriptor: WindowDescriptor = {
    handle: "0x1", pid: 123, processName: "terax", title: "Settings",
    x: 0, y: 0, width: 100, height: 100,
  };

  function visualHarness(snapshot: unknown) {
    const tools: RegisteredTool[] = [];
    const call = vi.fn(async () => snapshot);
    const discover = vi.fn(async () => ({ version: 1 as const, pid: 123, port: 4000, token: "token" }));
    const runVisual = vi.fn(async (request) => ({
      action: request.action,
      surface: request.surface,
      captureSucceeded: true as const,
      mediaPath: "/tmp/media.png",
      imagePath: "/tmp/media.png",
      reportPath: "/tmp/result.json",
      window: descriptor,
    } satisfies VisualQaResult));
    const dependencies: ExtensionDependencies = {
      discover,
      createClient: () => ({ call }),
      createVisualBackend: vi.fn(async () => ({ capture: vi.fn(), record: vi.fn(), compare: vi.fn() })),
      runVisual,
      readEvidence: vi.fn(async () => Buffer.from("png")) as ExtensionDependencies["readEvidence"],
    };
    createExtension(dependencies)({ registerTool: (tool: RegisteredTool) => tools.push(tool) } as never);
    return { visual: tools.find((tool) => tool.name === "terax_visual_qa"), dependencies, call, discover, runVisual };
  }

  it("registers only the compact Terax tool set", () => {
    const tools: RegisteredTool[] = [];
    extension({
      registerTool: (tool: RegisteredTool) => tools.push(tool),
    } as never);

    expect(tools.map((tool) => tool.name)).toEqual([
      "terax_get_state",
      "terax_call",
      "terax_wait",
      "terax_development_guide",
      "terax_visual_qa",
    ]);
  });

  it("blocks terax_call commands outside the allowlist", async () => {
    const tools: RegisteredTool[] = [];
    extension({
      registerTool: (tool: RegisteredTool) => tools.push(tool),
    } as never);
    const call = tools.find((tool) => tool.name === "terax_call");
    expect(call).toBeDefined();

    await expect(
      call?.execute("call-1", {
        command: "ai.diff.approve",
        payload: {},
      }),
    ).rejects.toThrow("Command ai.diff.approve is not allowed");
  });

  it("accepts tab.setColor as an allowlisted command", () => {
    expect(isTeraxCommandId("tab.setColor")).toBe(true);
    expect(TERAX_COMMAND_IDS).toContain("tab.setColor");
  });

  it("returns project contribution points for new windows", async () => {
    const tools: RegisteredTool[] = [];
    extension({
      registerTool: (tool: RegisteredTool) => tools.push(tool),
    } as never);
    const guide = tools.find((tool) => tool.name === "terax_development_guide");

    await expect(
      guide?.execute("guide-1", { capability: "window" }),
    ).resolves.toMatchObject({
      details: {
        guide: {
          capability: "window",
          inspect: expect.arrayContaining(["src-tauri/src/lib.rs"]),
        },
      },
    });
  });

  it("rejects visual capture outside a trusted Pi project", async () => {
    const tools: RegisteredTool[] = [];
    extension({
      registerTool: (tool: RegisteredTool) => tools.push(tool),
    } as never);
    const visual = tools.find((tool) => tool.name === "terax_visual_qa");

    await expect(
      visual?.execute(
        "visual-1",
        { action: "screenshot", surface: "main", name: "sidebar" },
        undefined,
        undefined,
        { cwd: "/workspace/terax", isProjectTrusted: () => false },
      ),
    ).rejects.toThrow("Visual QA requires a trusted Pi project");
  });

  it("prevalidates visual requests before discovery or any other effect", async () => {
    const harness = visualHarness({ tabs: [] });
    await expect(harness.visual?.execute(
      "visual-invalid",
      { action: "compare", surface: "main", name: "invalid" },
      undefined,
      undefined,
      { cwd: "/tmp/project", isProjectTrusted: () => true },
    )).rejects.toThrow("baselinePath is required");
    expect(harness.discover).not.toHaveBeenCalled();
    expect(harness.dependencies.createVisualBackend).not.toHaveBeenCalled();
    expect(harness.runVisual).not.toHaveBeenCalled();
  });

  it("authenticates settings with app.snapshot before and after capture", async () => {
    const harness = visualHarness({ tabs: [] });
    await expect(harness.visual?.execute(
      "visual-settings",
      { action: "screenshot", surface: "settings", name: "settings" },
      undefined,
      undefined,
      { cwd: "/tmp/project", isProjectTrusted: () => true },
    )).resolves.toMatchObject({ details: { surface: "settings" } });
    expect(harness.call).toHaveBeenCalledTimes(2);
    expect(harness.call.mock.calls.every(([command]) => command === "app.snapshot")).toBe(true);
  });

  it("waits without touching Terax transport", async () => {
    vi.useFakeTimers();
    const tools: RegisteredTool[] = [];
    extension({
      registerTool: (tool: RegisteredTool) => tools.push(tool),
    } as never);
    const wait = tools.find((tool) => tool.name === "terax_wait");
    const promise = wait?.execute("wait-1", { milliseconds: 50 });
    await vi.advanceTimersByTimeAsync(50);

    await expect(promise).resolves.toMatchObject({
      details: { waitedMs: 50 },
    });
    vi.useRealTimers();
  });
});
