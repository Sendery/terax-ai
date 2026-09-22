import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

/**
 * Subscription sign-in for providers that accept a browser login instead of an
 * API key.
 *
 * Everything sensitive stays in Rust (see `src-tauri/src/modules/oauth.rs`):
 * this module only starts and stops flows, reads the connection state, and
 * fetches a short-lived access token at the moment a request is made. Nothing
 * here persists a token, so a credential revoked in the provider's dashboard
 * stops working on the next request rather than at the next app start.
 */

/** Ids the Rust side knows; not the same namespace as Terax `ProviderId`. */
export type OAuthProviderId = "anthropic" | "openai-codex";

export type OAuthAccount = {
  provider: OAuthProviderId;
  /** Human name for the subscription, e.g. "Claude Pro/Max". */
  label: string;
  connected: boolean;
  /** Unix ms, null when not connected. */
  expires: number | null;
  /** The access token is past its expiry; a refresh happens on next use. */
  expired: boolean;
  email: string | null;
  accountId: string | null;
};

export type OAuthAccessToken = {
  token: string;
  accountId: string | null;
  expires: number;
};

export async function listOAuthAccounts(): Promise<OAuthAccount[]> {
  try {
    return await invoke<OAuthAccount[]>("oauth_status");
  } catch {
    return [];
  }
}

/**
 * Run a full sign-in: bind the callback listener, send the user to the
 * provider's consent page, and wait for the redirect.
 *
 * The consent URL is handed to `onUrl` as well as opened, because a login can
 * legitimately finish in a different browser than the default one, and because
 * an opener that silently fails would otherwise leave the user staring at a
 * spinner.
 */
export async function connectOAuth(
  provider: OAuthProviderId,
  onUrl?: (url: string) => void,
): Promise<OAuthAccount> {
  const { url } = await invoke<{ url: string }>("oauth_begin", { provider });
  onUrl?.(url);
  try {
    await openUrl(url);
  } catch {
    // No default browser, or the opener is unavailable: the URL is already in
    // the UI, so the flow can still be completed by hand.
  }
  try {
    return await invoke<OAuthAccount>("oauth_complete", { provider });
  } catch (error) {
    // Releases the callback port; without this a failed attempt would make the
    // next one fail too, with a confusing "port in use".
    await cancelOAuth(provider);
    throw error;
  }
}

export async function cancelOAuth(provider: OAuthProviderId): Promise<void> {
  try {
    await invoke("oauth_cancel", { provider });
  } catch {
    // Nothing pending is the normal case here.
  }
}

export async function disconnectOAuth(
  provider: OAuthProviderId,
): Promise<void> {
  await invoke("oauth_logout", { provider });
}

/** A token good to use now; Rust refreshes it first when it is about to lapse. */
export function oauthAccessToken(
  provider: OAuthProviderId,
): Promise<OAuthAccessToken> {
  return invoke<OAuthAccessToken>("oauth_access_token", { provider });
}

export function isOAuthConnected(
  accounts: readonly OAuthAccount[],
  provider: OAuthProviderId,
): boolean {
  return accounts.some((a) => a.provider === provider && a.connected);
}

/** Message for the "connected as" line, falling back when no email was issued. */
export function accountDescription(account: OAuthAccount): string {
  if (!account.connected) return "Not connected";
  if (account.email) return account.email;
  return account.accountId ? `Account ${account.accountId}` : "Connected";
}
