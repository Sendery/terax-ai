import { beforeEach, describe, expect, it, vi } from "vitest";

const coreMock = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => coreMock);

import {
  FULL_DISK_ACCESS_HINT_KEY,
  fullDiskAccessCopy,
  fullDiskAccessHintSeen,
  markFullDiskAccessHintSeen,
  openFullDiskAccessSettings,
  readFullDiskAccess,
  shouldHintFullDiskAccess,
} from "./fullDiskAccess";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}

describe("full disk access", () => {
  beforeEach(() => coreMock.invoke.mockReset());

  it("reads the status from the backend", async () => {
    coreMock.invoke.mockResolvedValueOnce("denied");
    expect(await readFullDiskAccess()).toBe("denied");
    expect(coreMock.invoke).toHaveBeenCalledWith("privacy_full_disk_access");
  });

  it("treats a failed probe as unknown rather than as denied", async () => {
    coreMock.invoke.mockRejectedValueOnce(new Error("no such command"));
    expect(await readFullDiskAccess()).toBe("unknown");
  });

  it("opens the system pane through the backend", async () => {
    coreMock.invoke.mockResolvedValueOnce(undefined);
    await openFullDiskAccessSettings();
    expect(coreMock.invoke).toHaveBeenCalledWith(
      "privacy_open_full_disk_access",
    );
  });

  it("hints only when access is refused and only until it was seen", () => {
    expect(shouldHintFullDiskAccess("denied", false)).toBe(true);
    expect(shouldHintFullDiskAccess("denied", true)).toBe(false);
    expect(shouldHintFullDiskAccess("granted", false)).toBe(false);
    expect(shouldHintFullDiskAccess("unknown", false)).toBe(false);
    expect(shouldHintFullDiskAccess("not-applicable", false)).toBe(false);
  });

  it("remembers that the hint was shown", () => {
    const storage = memoryStorage();
    expect(fullDiskAccessHintSeen(storage)).toBe(false);
    markFullDiskAccessHintSeen(storage);
    expect(storage.getItem(FULL_DISK_ACCESS_HINT_KEY)).toBe("1");
    expect(fullDiskAccessHintSeen(storage)).toBe(true);
  });

  it("survives storage that throws", () => {
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(fullDiskAccessHintSeen(broken)).toBe(false);
    expect(() => markFullDiskAccessHintSeen(broken)).not.toThrow();
  });

  it("says what the grant covers and that a sandbox needs its own", () => {
    const installed = fullDiskAccessCopy(false);
    expect(installed.title).toContain("Terax");
    expect(installed.body).toContain("every shell and agent");
    expect(installed.body).toContain("separate app");

    const sandbox = fullDiskAccessCopy(true);
    expect(sandbox.title).toContain("this sandbox");
    expect(sandbox.body).toContain("its own grant once");
  });
});
