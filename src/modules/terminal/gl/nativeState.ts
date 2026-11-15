export type NativeState = Readonly<{
  version: number;
  alternateScreen: boolean;
  mouseTracking: boolean;
  bracketedPaste: boolean;
  focusTracking: boolean;
  modifyOtherKeys: number;
  kittyFlags: number;
}>;
export function decodeNativeState(value: unknown): NativeState {
  if (!value || typeof value !== "object")
    throw new Error("invalid native terminal state");
  const data = value as Record<string, unknown>;
  for (const field of [
    "alternateScreen",
    "mouseTracking",
    "bracketedPaste",
    "focusTracking",
  ])
    if (typeof data[field] !== "boolean")
      throw new Error("invalid native terminal state");
  for (const [field, max] of [
    ["version", Number.MAX_SAFE_INTEGER],
    ["modifyOtherKeys", 0xffff_ffff],
    ["kittyFlags", 31],
  ] as const)
    if (
      typeof data[field] !== "number" ||
      !Number.isSafeInteger(data[field]) ||
      data[field] < 0 ||
      data[field] > max
    )
      throw new Error("invalid native terminal state");
  return {
    version: data.version as number,
    alternateScreen: data.alternateScreen as boolean,
    mouseTracking: data.mouseTracking as boolean,
    bracketedPaste: data.bracketedPaste as boolean,
    focusTracking: data.focusTracking as boolean,
    modifyOtherKeys: data.modifyOtherKeys as number,
    kittyFlags: data.kittyFlags as number,
  };
}
