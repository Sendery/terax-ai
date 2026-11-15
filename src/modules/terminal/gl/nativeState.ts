export type NativeState = Readonly<{
  version: number;
  alternateScreen: boolean;
  mouseTracking: boolean;
  bracketedPaste: boolean;
  focusTracking: boolean;
  modifyOtherKeys: number;
  kittyFlags: number;
  cwd: string | null;
  shellReady: boolean;
  commandRunning: boolean;
  blocksEnabled: boolean;
  blocksMetadataVersion: number;
  promptVersion: number;
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
    "shellReady",
    "commandRunning",
    "blocksEnabled",
  ])
    if (typeof data[field] !== "boolean")
      throw new Error("invalid native terminal state");
  for (const [field, max] of [
    ["version", Number.MAX_SAFE_INTEGER],
    ["blocksMetadataVersion", Number.MAX_SAFE_INTEGER],
    ["promptVersion", Number.MAX_SAFE_INTEGER],
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
  const cwd = data.cwd;
  if (
    cwd !== null &&
    (typeof cwd !== "string" ||
      !/^(?:\/|[A-Za-z]:[\\/])/.test(cwd) ||
      /[\u0000-\u001f\u007f-\u009f]/.test(cwd) ||
      new TextEncoder().encode(cwd).byteLength > 128 * 1024)
  )
    throw new Error("invalid native terminal state");
  return {
    cwd: cwd as string | null,
    shellReady: data.shellReady as boolean,
    commandRunning: data.commandRunning as boolean,
    blocksEnabled: data.blocksEnabled as boolean,
    blocksMetadataVersion: data.blocksMetadataVersion as number,
    promptVersion: data.promptVersion as number,
    version: data.version as number,
    alternateScreen: data.alternateScreen as boolean,
    mouseTracking: data.mouseTracking as boolean,
    bracketedPaste: data.bracketedPaste as boolean,
    focusTracking: data.focusTracking as boolean,
    modifyOtherKeys: data.modifyOtherKeys as number,
    kittyFlags: data.kittyFlags as number,
  };
}
