import { describe, expect, it, vi } from "vitest";
import extension from "../src/extension.js";

type RegisteredTool = {
  name: string;
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<{ content: { type: "text"; text: string }[]; details: unknown }>;
};

describe("Pi extension", () => {
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
