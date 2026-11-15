// URL boundaries follow the pinned @xterm/addon-web-links policy (MIT).
export const TERMINAL_URL_REGEX =
  /(https?|HTTPS?):[/]{2}[^\s"'!*(){}|\\^<>`]*[^\s"':,.!?{}|\\^~[\]`()<>]/;
export function safeExternalTerminalUrl(uri: string): string | null {
  if (
    !uri ||
    /[\u0000-\u0020\u007f-\u009f]/.test(uri) ||
    !/^(https?:|mailto:|tel:)/i.test(uri)
  )
    return null;
  try {
    const url = new URL(uri);
    if (url.protocol === "http:" || url.protocol === "https:") {
      if (!/^https?:\/\//i.test(uri) || !url.hostname) return null;
    } else if (!url.pathname) return null;
    return uri;
  } catch {
    return null;
  }
}
export function terminalUrlAt(
  text: string,
  offset: number,
  startClipped = false,
  endClipped = false,
): { url: string; start: number; end: number } | null {
  const pattern = new RegExp(TERMINAL_URL_REGEX.source, "g");
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (start > offset || offset >= end) continue;
    let rawStart = start;
    let rawEnd = end;
    while (rawStart > 0 && !/\s/.test(text[rawStart - 1])) rawStart--;
    while (rawEnd < text.length && !/\s/.test(text[rawEnd])) rawEnd++;
    if (
      match[0].length > 2048 ||
      (startClipped && rawStart === 0) ||
      (endClipped && rawEnd === text.length)
    )
      return null;
    const url = safeExternalTerminalUrl(match[0]);
    return url ? { url, start, end } : null;
  }
  return null;
}
