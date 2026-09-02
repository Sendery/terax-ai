const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/** Sizes here span a 300 MB model and a 4 GB one, so the unit has to scale. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = value < 10 && unit > 0 ? 1 : 0;
  return `${value.toFixed(digits)} ${UNITS[unit]}`;
}

export function formatApproxBytes(bytes: number): string {
  return `~${formatBytes(bytes)}`;
}
