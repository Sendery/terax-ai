import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const KEY = "terax-ui-chat-layout";

function stubStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const setItem = vi.fn((k: string, v: string) => {
    data.set(k, v);
  });
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (k: string) => data.get(k) ?? null,
      setItem,
    },
  });
  return { data, setItem };
}

async function freshStore() {
  vi.resetModules();
  return (await import("./chatLayoutStore")).useChatLayoutStore;
}

describe("useChatLayoutStore", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it("starts floating when nothing was stored", async () => {
    stubStorage();
    const store = await freshStore();
    expect(store.getState().mode).toBe("floating");
  });

  it("survives a restart", async () => {
    const { data } = stubStorage();
    const first = await freshStore();
    first.getState().setMode("right");
    first.getState().setDockWidth(512.6);
    first.getState().setBottomHeight(260);
    expect(JSON.parse(data.get(KEY) ?? "{}")).toEqual({
      mode: "right",
      dockWidth: 513,
      bottomHeight: 260,
    });

    const second = await freshStore();
    expect(second.getState()).toMatchObject({
      mode: "right",
      dockWidth: 513,
      bottomHeight: 260,
    });
  });

  it("does not write when nothing changed", async () => {
    const { setItem } = stubStorage();
    const store = await freshStore();
    store.getState().setMode("floating");
    expect(setItem).not.toHaveBeenCalled();
  });

  it("recovers from a corrupt entry", async () => {
    stubStorage({ [KEY]: "{not json" });
    const store = await freshStore();
    expect(store.getState().mode).toBe("floating");
  });
});
