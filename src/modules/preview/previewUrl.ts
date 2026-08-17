/**
 * Preview surfaces load remote content inside the app webview, so programmatic
 * callers (the in-app AI tools and the authenticated Pi bridge) are restricted
 * to loopback dev servers. Users can still type any address in the address bar,
 * where the navigation is an explicit human action.
 */
export function isLoopbackPreviewUrl(raw: unknown): raw is string {
  return normalizePreviewUrl(raw) !== null;
}

/** Canonical form used to compare a requested URL against open preview tabs. */
export function normalizePreviewUrl(raw: unknown): string | null {
  return loopbackHref(raw);
}

/** True when both URLs address the same loopback resource. */
export function samePreviewUrl(a: unknown, b: unknown): boolean {
  const left = normalizePreviewUrl(a);
  return left !== null && left === normalizePreviewUrl(b);
}

function loopbackHref(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const isLoopback =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host.endsWith(".localhost");
  return isLoopback ? parsed.href : null;
}
