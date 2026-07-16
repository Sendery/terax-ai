export { TeraxClient } from "./client.js";
export type { TeraxClientOptions } from "./client.js";
export {
  isTeraxCommandId,
  TERAX_COMMAND_IDS,
  type TeraxCommandId,
} from "./commands.js";
export {
  DEVELOPMENT_CAPABILITIES,
  getDevelopmentGuide,
  isDevelopmentCapability,
  type DevelopmentCapability,
  type DevelopmentGuide,
} from "./development.js";
export {
  DISCOVERY_COMMAND_TIMEOUT_MS,
  DISCOVERY_OUTPUT_LIMIT_BYTES,
  discoverTerax,
  discoveryFilePath,
  type DiscoverOptions,
  type DiscoveryCommandOptions,
  type DiscoveryCommandRunner,
  type TeraxDiscovery,
} from "./discovery.js";
export { MAX_FRAME_BYTES, PROTOCOL_VERSION } from "./protocol.js";
export type { TeraxResponse } from "./protocol.js";
export {
  DEFAULT_GUARD_INTERVAL_MS,
  MAX_CAPTURE_HEIGHT,
  MAX_CAPTURE_PIXELS,
  MAX_CAPTURE_WIDTH,
  MAX_BASELINE_BYTES,
  MAX_TEMP_BYTES,
  MAX_VIDEO_DURATION_SECONDS,
  MAX_VIDEO_FPS,
  MAX_VIDEO_FRAMES,
  NATIVE_CAPTURE_TARGETS,
  assertVisualCaptureSafe,
  buildArtifactPaths,
  isNativeCaptureTarget,
  buildVideoArgs,
  parseSsim,
  parseWindowDescriptor,
  runVisualQa,
  sanitizeArtifactName,
  surfaceSelector,
  validateVisualQaRequest,
  type ArtifactPaths,
  type VisualAction,
  type VisualBackend,
  type VisualQaRequest,
  type NativeCaptureTarget,
  type VisualQaResult,
  type ValidatedVisualQaRequest,
  type VisualSurface,
  type WindowDescriptor,
  type WindowSelector,
} from "./visual.js";
export {
  createNativeVisualBackend,
  parseCaptureOutcome,
  type CaptureOutcome,
  type NativeCaptureClient,
  type NativeVisualBackendOptions,
} from "./visual-native.js";
export {
  COMMAND_OUTPUT_LIMIT_BYTES,
  COMMAND_TIMEOUT_MS,
  COMMAND_TERMINATION_GRACE_MS,
  MAX_RECORD_COMMAND_TIMEOUT_MS,
  buildSsimArgs,
  createSystemWindowsVisualBackend,
  createWindowsVisualBackend,
  encodePowerShell,
  runVisualCommand,
  recordCommandTimeoutMs,
  withWslInteropEnv,
  type SystemVisualBackendOptions,
  type VisualCommandOptions,
  type VisualCommandResult,
  type VisualCommandRunner,
  type WindowsVisualRuntime,
} from "./visual-windows.js";
