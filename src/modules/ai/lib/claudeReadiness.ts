type TuiWaitResult = "ready" | "gone" | "timeout";

export async function waitForClaudeTuiReady(
  readBuf: () => string | null | Promise<string | null>,
  timeoutMs = 8000,
): Promise<TuiWaitResult> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const buf = await readBuf();
    if (buf === null) return "gone";
    if (buf.includes("shortcuts") || buf.includes("? for")) return "ready";
    await new Promise((r) => setTimeout(r, 120));
  }
  return "timeout";
}
