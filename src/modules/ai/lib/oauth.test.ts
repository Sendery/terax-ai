import { beforeEach, describe, expect, it, vi } from "vitest";

const coreMock = vi.hoisted(() => ({ invoke: vi.fn() }));
const openerMock = vi.hoisted(() => ({
  openUrl: vi.fn(async () => undefined),
}));

vi.mock("@tauri-apps/api/core", () => coreMock);
vi.mock("@tauri-apps/plugin-opener", () => openerMock);

import {
  accountDescription,
  cancelOAuth,
  connectOAuth,
  isOAuthConnected,
  listOAuthAccounts,
  type OAuthAccount,
} from "./oauth";

function account(patch: Partial<OAuthAccount> = {}): OAuthAccount {
  return {
    provider: "anthropic",
    label: "Claude Pro/Max",
    connected: true,
    expires: Date.now() + 3_600_000,
    expired: false,
    email: null,
    accountId: null,
    ...patch,
  };
}

beforeEach(() => {
  coreMock.invoke.mockReset();
  openerMock.openUrl.mockReset();
  openerMock.openUrl.mockResolvedValue(undefined);
});

describe("listOAuthAccounts", () => {
  it("returns what the backend reports", async () => {
    coreMock.invoke.mockResolvedValueOnce([account()]);
    const accounts = await listOAuthAccounts();
    expect(accounts).toHaveLength(1);
    expect(coreMock.invoke).toHaveBeenCalledWith("oauth_status");
  });

  it("reports no accounts rather than throwing when the backend fails", async () => {
    // Settings renders this on mount; a failure here must not blank the page.
    coreMock.invoke.mockRejectedValueOnce(new Error("keychain locked"));
    await expect(listOAuthAccounts()).resolves.toEqual([]);
  });
});

describe("connectOAuth", () => {
  it("opens the consent URL and hands it to the caller before waiting", async () => {
    const seen: string[] = [];
    coreMock.invoke
      .mockResolvedValueOnce({ url: "https://claude.ai/oauth/authorize?x=1" })
      .mockResolvedValueOnce(account());

    await connectOAuth("anthropic", (url) => seen.push(url));

    expect(seen).toEqual(["https://claude.ai/oauth/authorize?x=1"]);
    expect(openerMock.openUrl).toHaveBeenCalledWith(
      "https://claude.ai/oauth/authorize?x=1",
    );
    expect(coreMock.invoke.mock.calls.map((c) => c[0])).toEqual([
      "oauth_begin",
      "oauth_complete",
    ]);
  });

  it("still waits for the callback when no browser could be opened", async () => {
    // The URL is on screen either way, so a headless or misconfigured desktop
    // can finish the login by hand instead of the flow dying here.
    coreMock.invoke
      .mockResolvedValueOnce({ url: "https://auth.openai.com/oauth/authorize" })
      .mockResolvedValueOnce(account({ provider: "openai-codex" }));
    openerMock.openUrl.mockRejectedValueOnce(new Error("no opener"));

    const result = await connectOAuth("openai-codex");
    expect(result.provider).toBe("openai-codex");
  });

  it("releases the callback port when the wait fails", async () => {
    // Without the cancel, the listener would still hold the fixed port and the
    // next attempt would fail with a confusing "address in use".
    coreMock.invoke
      .mockResolvedValueOnce({ url: "https://claude.ai/oauth/authorize" })
      .mockRejectedValueOnce(new Error("Timed out"))
      .mockResolvedValueOnce(undefined);

    await expect(connectOAuth("anthropic")).rejects.toThrow("Timed out");
    expect(coreMock.invoke.mock.calls.map((c) => c[0])).toEqual([
      "oauth_begin",
      "oauth_complete",
      "oauth_cancel",
    ]);
  });

  it("does not swallow a begin failure with a cancel", async () => {
    coreMock.invoke.mockRejectedValueOnce(new Error("port 1455 in use"));
    await expect(connectOAuth("openai-codex")).rejects.toThrow("port 1455");
    expect(coreMock.invoke).toHaveBeenCalledTimes(1);
  });
});

describe("cancelOAuth", () => {
  it("ignores a backend that has nothing pending", async () => {
    coreMock.invoke.mockRejectedValueOnce(new Error("nothing pending"));
    await expect(cancelOAuth("anthropic")).resolves.toBeUndefined();
  });
});

describe("isOAuthConnected", () => {
  it("is false for a provider that is present but disconnected", () => {
    const accounts = [account({ connected: false })];
    expect(isOAuthConnected(accounts, "anthropic")).toBe(false);
  });

  it("is true only for the matching provider", () => {
    const accounts = [
      account(),
      account({ provider: "openai-codex", connected: false }),
    ];
    expect(isOAuthConnected(accounts, "anthropic")).toBe(true);
    expect(isOAuthConnected(accounts, "openai-codex")).toBe(false);
  });

  it("is true for an expired-but-connected account", () => {
    // The refresh token is what keeps the account usable; an expired access
    // token must not read as signed out.
    expect(isOAuthConnected([account({ expired: true })], "anthropic")).toBe(
      true,
    );
  });
});

describe("accountDescription", () => {
  it("prefers the email", () => {
    expect(accountDescription(account({ email: "a@b.c" }))).toBe("a@b.c");
  });

  it("falls back to the account id, then to a bare label", () => {
    expect(accountDescription(account({ accountId: "acct-1" }))).toBe(
      "Account acct-1",
    );
    expect(accountDescription(account())).toBe("Connected");
  });

  it("says so when the provider is not connected", () => {
    expect(accountDescription(account({ connected: false }))).toBe(
      "Not connected",
    );
  });
});
