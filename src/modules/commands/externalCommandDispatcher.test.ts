import { describe, expect, it, vi } from "vitest";
import { createExternalCommandDispatcher } from "./externalCommandDispatcher";
import type { CommandResult } from "./lib/registry";

type Call = { id: string; payload?: unknown };

function registryStub(name: string, calls: Call[]) {
  return {
    call: async (request: Call): Promise<CommandResult> => {
      calls.push(request);
      return { ok: true, value: { by: name } };
    },
  };
}

describe("createExternalCommandDispatcher", () => {
  it("answers a request with the current registry", async () => {
    const calls: Call[] = [];
    const respond = vi.fn(async () => undefined);
    const dispatcher = createExternalCommandDispatcher(respond);
    dispatcher.setRegistry(registryStub("a", calls));

    await dispatcher.handle({ requestId: "r1", command: "app.snapshot" });

    expect(calls).toEqual([{ id: "app.snapshot", payload: undefined }]);
    expect(respond).toHaveBeenCalledWith("r1", {
      ok: true,
      value: { by: "a" },
    });
  });

  it("keeps answering after the handlers are replaced", async () => {
    // App rebuilds its handler object on almost every state change. A request
    // that lands right after a mutating command must still be answered, so
    // swapping the registry can never drop an event.
    const calls: Call[] = [];
    const respond = vi.fn(async () => undefined);
    const dispatcher = createExternalCommandDispatcher(respond);
    dispatcher.setRegistry(registryStub("before", calls));

    await dispatcher.handle({ requestId: "r1", command: "notes.add" });
    dispatcher.setRegistry(registryStub("after", calls));
    await dispatcher.handle({ requestId: "r2", command: "notes.list" });

    expect(respond).toHaveBeenNthCalledWith(2, "r2", {
      ok: true,
      value: { by: "after" },
    });
  });

  it("reports an internal error instead of leaving the caller to time out", async () => {
    const respond = vi.fn(async () => undefined);
    const dispatcher = createExternalCommandDispatcher(respond);
    dispatcher.setRegistry({
      call: async () => {
        throw new Error("boom");
      },
    });

    await dispatcher.handle({ requestId: "r1", command: "app.snapshot" });

    expect(respond).toHaveBeenCalledWith("r1", {
      ok: false,
      error: { code: "internal_error", message: "boom" },
    });
  });

  it("reports an internal error when no registry is installed yet", async () => {
    const respond = vi.fn(async () => undefined);
    const dispatcher = createExternalCommandDispatcher(respond);

    await dispatcher.handle({ requestId: "r1", command: "app.snapshot" });

    expect(respond).toHaveBeenCalledWith("r1", {
      ok: false,
      error: {
        code: "internal_error",
        message: "Command bridge is not ready",
      },
    });
  });

  it("never leaks a stack trace to the caller", async () => {
    const respond = vi.fn(async () => undefined);
    const dispatcher = createExternalCommandDispatcher(respond);
    dispatcher.setRegistry({
      call: async () => {
        throw new Error("boom");
      },
    });

    await dispatcher.handle({ requestId: "r1", command: "app.snapshot" });

    expect(JSON.stringify(respond.mock.calls)).not.toContain("at ");
  });
});
