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
      createNativeBackend: vi.fn(() => ({ capture: vi.fn(), record: vi.fn(), compare: vi.fn() })),
      runVisual,
      readEvidence: vi.fn(async () => Buffer.from("png")) as ExtensionDependencies["readEvidence"],
      hostEnv: { TERAX_TERMINAL: "1" },
    };
    createExtension(dependencies)({ registerTool: (tool: RegisteredTool) => tools.push(tool), on: () => {} } as never);
    return { visual: tools.find((tool) => tool.name === "terax_visual_qa"), dependencies, call, discover, runVisual };
  }

  function registerWith(env: Record<string, string | undefined>) {
    const tools: RegisteredTool[] = [];
    const events: Record<string, Array<(...a: unknown[]) => unknown>> = {};
    const messages: unknown[] = [];
    const pi = {
      registerTool: (tool: RegisteredTool) => tools.push(tool),
      on: (event: string, handler: (...a: unknown[]) => unknown) => {
        (events[event] ??= []).push(handler);
      },
      sendMessage: (message: unknown) => messages.push(message),
    };
    createExtension({ hostEnv: env })(pi as never);
    return { tools, events, messages };
  }

  async function emitLifecycle(
    handlers: Record<string, Array<(...a: unknown[]) => unknown>>,
    event: string,
    isIdle: boolean,
    mode: "tui" | "rpc" | "json" | "print" = "tui",
  ) {
    for (const handler of handlers[event] ?? []) {
      await handler({ reason: "reload" }, { isIdle: () => isIdle, mode });
    }
  }

  it("registers the full tool set inside a Terax terminal", () => {
    const { tools } = registerWith({ TERAX_TERMINAL: "1" });
    expect(tools.map((tool) => tool.name)).toEqual([
      "terax_status",
      "terax_get_state",
      "terax_call",
      "terax_wait",
      "terax_development_guide",
      "terax_visual_qa",
    ]);
  });

  it("exposes only terax_status outside a Terax terminal", () => {
    const { tools } = registerWith({ TERM_PROGRAM: "Apple_Terminal" });
    expect(tools.map((tool) => tool.name)).toEqual(["terax_status"]);
  });

  it("default export always registers the terax_status entrypoint", () => {
    const tools: RegisteredTool[] = [];
    extension({ registerTool: (t: RegisteredTool) => tools.push(t), on: () => {} } as never);
    expect(tools.map((t) => t.name)).toContain("terax_status");
  });

  it("TERAX_FORCE restores the full set from a non-Terax shell", () => {
    const { tools } = registerWith({
      TERM_PROGRAM: "iTerm.app",
      TERAX_FORCE: "1",
    });
    expect(tools.map((tool) => tool.name)).toContain("terax_call");
  });

  it("informs once at session start when unavailable, and stays quiet when available", async () => {
    const outside = registerWith({ TERM_PROGRAM: "Apple_Terminal" });
    for (const handler of outside.events.session_start ?? []) await handler();
    expect(outside.messages.length).toBe(1);
    expect(JSON.stringify(outside.messages[0])).toMatch(/not.+Terax/i);

    const inside = registerWith({ TERAX_TERMINAL: "1" });
    await emitLifecycle(inside.events, "session_start", true);
    expect(inside.messages.length).toBe(0);
  });

  it("emits working when an active TUI session starts or reloads", async () => {
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      const { events } = registerWith({ TERAX_TERMINAL: "1" });

      await emitLifecycle(events, "session_start", false);
      await emitLifecycle(events, "session_start", true);
      await emitLifecycle(events, "session_start", false, "rpc");

      expect(write.mock.calls).toEqual([
        ["\x1b]777;notify;Terax;pi;working\x07"],
      ]);
    } finally {
      write.mockRestore();
    }
  });

  it("emits working when a TUI agent starts", async () => {
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      const { events } = registerWith({ TERAX_TERMINAL: "1" });

      await emitLifecycle(events, "agent_start", true);
      await emitLifecycle(events, "agent_start", true, "print");

      expect(write.mock.calls).toEqual([
        ["\x1b]777;notify;Terax;pi;working\x07"],
      ]);
    } finally {
      write.mockRestore();
    }
  });

  it("emits finished only after a TUI agent settles idle", async () => {
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      const { events } = registerWith({ TERAX_TERMINAL: "1" });

      await emitLifecycle(events, "agent_settled", false);
      await emitLifecycle(events, "agent_settled", true, "json");
      await emitLifecycle(events, "agent_settled", true);

      expect(write.mock.calls).toEqual([
        ["\x1b]777;notify;Terax;pi;finished\x07"],
      ]);
    } finally {
      write.mockRestore();
    }
  });

  it("does not register monitor lifecycle handlers outside Terax", () => {
    const { events } = registerWith({ TERM_PROGRAM: "Apple_Terminal" });
    expect(events.agent_start).toBeUndefined();
    expect(events.agent_settled).toBeUndefined();
  });

  it("terax_status reports availability and enable instructions when outside", async () => {
    const { tools } = registerWith({ TERM_PROGRAM: "Apple_Terminal" });
    const status = tools.find((t) => t.name === "terax_status");
    const result = await status?.execute("s1", {});
    const details = result?.details as {
      available: boolean;
      inTerax: boolean;
      enable?: { command: string; steps: string[] };
    };
    expect(details.available).toBe(false);
    expect(details.inTerax).toBe(false);
    expect(details.enable?.steps.length).toBeGreaterThan(0);
    expect(typeof details.enable?.command).toBe("string");
  });

  it("blocks terax_call commands outside the allowlist", async () => {
    const { tools } = registerWith({ TERAX_TERMINAL: "1" });
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

  it("accepts preview.open as an allowlisted command", () => {
    expect(isTeraxCommandId("preview.open")).toBe(true);
    expect(TERAX_COMMAND_IDS).toContain("preview.open");
  });

  it("exposes app.commands as the payload discovery command", () => {
    expect(isTeraxCommandId("app.commands")).toBe(true);
    expect(TERAX_COMMAND_IDS).toContain("app.commands");
  });

  it("allowlists the scheduled task commands", () => {
    for (const id of [
      "tasks.show",
      "tasks.hide",
      "tasks.toggle",
      "tasks.openEditor",
      "tasks.list",
      "tasks.add",
      "tasks.update",
      "tasks.clone",
      "tasks.reseed",
      "tasks.remove",
      "tasks.run",
      "tasks.setEnabled",
      "tasks.pauseAll",
      "tasks.resumeAll",
      "tasks.wake",
    ]) {
      expect(isTeraxCommandId(id), id).toBe(true);
      expect(TERAX_COMMAND_IDS).toContain(id);
    }
  });

  it("does not allowlist a task command the app does not implement", () => {
    expect(isTeraxCommandId("tasks.wipe")).toBe(false);
    expect(isTeraxCommandId("tasks.exportPrompts")).toBe(false);
  });

  it("offers every allowlisted task command through terax_call", () => {
    const { tools } = registerWith({ TERAX_TERMINAL: "1" });
    const call = tools.find(
      (tool) => (tool as { name: string }).name === "terax_call",
    ) as unknown as { parameters?: unknown };
    const params = call?.parameters as {
      properties?: { command?: { anyOf?: { const?: string }[] } };
    };
    const offered = (params?.properties?.command?.anyOf ?? []).map(
      (entry) => entry.const,
    );
    for (const id of TERAX_COMMAND_IDS.filter((c) => c.startsWith("tasks."))) {
      expect(offered, id).toContain(id);
    }
  });

  it("describes terax_call payload as an open object so hosts forward it", () => {
    const { tools } = registerWith({ TERAX_TERMINAL: "1" });
    const call = tools.find(
      (tool) => (tool as { name: string }).name === "terax_call",
    ) as unknown as { parameters?: unknown };
    const params = call?.parameters as {
      properties?: { payload?: Record<string, unknown> };
    };
    const payload = params?.properties?.payload;
    expect(payload).toBeDefined();
    // Type.Any() compiles to an empty schema that arg sanitizers drop; the
    // payload must be a typed object so nested arguments survive transport.
    expect(payload?.type).toBe("object");
    expect(payload?.additionalProperties).toBe(true);
  });

  it("returns project contribution points for new windows", async () => {
    const { tools } = registerWith({ TERAX_TERMINAL: "1" });
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
    const { tools } = registerWith({ TERAX_TERMINAL: "1" });
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

  it("uses the native in-app backend for the main surface", async () => {
    const harness = visualHarness({ tabs: [] });
    await expect(harness.visual?.execute(
      "visual-native",
      { action: "screenshot", surface: "main", name: "native", target: "sidebar" },
      undefined,
      undefined,
      { cwd: "/tmp/project", isProjectTrusted: () => true },
    )).resolves.toMatchObject({ details: { surface: "main" } });
    expect(harness.dependencies.createNativeBackend).toHaveBeenCalledWith(
      expect.objectContaining({ pid: 123, target: "sidebar" }),
    );
    expect(harness.dependencies.createVisualBackend).not.toHaveBeenCalled();
  });

  it("routes an agent-monitor capture through Pi's native in-app backend", async () => {
    const harness = visualHarness({ tabs: [] });
    await harness.visual?.execute(
      "visual-agent-monitor",
      {
        action: "screenshot",
        surface: "main",
        name: "agent-monitor",
        target: "agent-monitor",
      },
      undefined,
      undefined,
      { cwd: "/tmp/project", isProjectTrusted: () => true },
    );
    expect(harness.dependencies.createNativeBackend).toHaveBeenCalledWith(
      expect.objectContaining({ pid: 123, target: "agent-monitor" }),
    );
    expect(harness.dependencies.createVisualBackend).not.toHaveBeenCalled();
  });

  it("defaults the native target to the whole window", async () => {
    const harness = visualHarness({ tabs: [] });
    await harness.visual?.execute(
      "visual-native-default",
      { action: "screenshot", surface: "main", name: "native" },
      undefined,
      undefined,
      { cwd: "/tmp/project", isProjectTrusted: () => true },
    );
    expect(harness.dependencies.createNativeBackend).toHaveBeenCalledWith(
      expect.objectContaining({ target: "window" }),
    );
  });

  it("keeps the system backend for the settings surface", async () => {
    const harness = visualHarness({ tabs: [] });
    await harness.visual?.execute(
      "visual-settings-system",
      { action: "screenshot", surface: "settings", name: "settings" },
      undefined,
      undefined,
      { cwd: "/tmp/project", isProjectTrusted: () => true },
    );
    expect(harness.dependencies.createVisualBackend).toHaveBeenCalled();
    expect(harness.dependencies.createNativeBackend).not.toHaveBeenCalled();
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
    const { tools } = registerWith({ TERAX_TERMINAL: "1" });
    const wait = tools.find((tool) => tool.name === "terax_wait");
    const promise = wait?.execute("wait-1", { milliseconds: 50 });
    await vi.advanceTimersByTimeAsync(50);

    await expect(promise).resolves.toMatchObject({
      details: { waitedMs: 50 },
    });
    vi.useRealTimers();
  });
});
