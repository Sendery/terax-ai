import { afterEach, describe, expect, it, vi } from "vitest";
import { COMMAND_IDS } from "@/modules/commands";
import { setInAppCommandRegistry } from "@/modules/commands/lib/inApp";
import { appCommandNeedsApproval, buildAppTools } from "./app";

afterEach(() => setInAppCommandRegistry(null));

const opts = { toolCallId: "t", messages: [] } as never;

describe("appCommandNeedsApproval", () => {
  it("asks before scheduling agents, installing software or deleting data", () => {
    for (const id of ["tasks.add", "tasks.run", "tasks.wake", "tts.install", "notes.remove", "tab.close"]) {
      expect(appCommandNeedsApproval(id), id).toBe(true);
    }
  });

  it("lets navigation and reads through", () => {
    for (const id of ["app.snapshot", "app.commands", "tab.focus", "notes.show", "preview.open", "search.content"]) {
      expect(appCommandNeedsApproval(id), id).toBe(false);
    }
  });

  it("only names real registry commands", () => {
    const risky = COMMAND_IDS.filter(appCommandNeedsApproval);
    expect(risky.length).toBe(14);
  });
});

describe("buildAppTools", () => {
  it("dispatches through the live registry and returns its result", async () => {
    const call = vi.fn(async () => ({ ok: true as const, value: { tabId: 3 } }));
    setInAppCommandRegistry({ call });
    const tools = buildAppTools();
    const out = await tools.terax_app_command.execute?.(
      { command: "tab.focus", payload: { tabId: 3 } },
      opts,
    );
    expect(call).toHaveBeenCalledWith({ id: "tab.focus", payload: { tabId: 3 } });
    expect(out).toEqual({ ok: true, value: { tabId: 3 } });
  });

  it("reports a registry error instead of throwing", async () => {
    setInAppCommandRegistry({
      call: async () => ({ ok: false as const, error: { code: "invalid_payload" as const, message: "tabId required" } }),
    });
    const out = await buildAppTools().terax_app_state.execute?.({}, opts);
    expect(out).toEqual({ ok: false, error: { code: "invalid_payload", message: "tabId required" } });
  });

  it("explains when the window has not published its registry yet", async () => {
    const out = await buildAppTools().terax_app_state.execute?.({}, opts);
    expect(out).toMatchObject({ ok: false, error: { code: "internal_error" } });
  });
});
