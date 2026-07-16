export {
  CAPTURE_PREPARE_EVENT,
  type CaptureOutcome,
  captureSurface,
  resolveCaptureElement,
} from "./lib/capture";
export {
  type CaptureImage,
  registerCanvasSnapshotProvider,
} from "./lib/rasterize";
export {
  CAPTURE_TARGETS,
  type CaptureRequest,
  type CaptureTarget,
  captureBlockReason,
  isCaptureTarget,
  validateCaptureRequest,
} from "./lib/targets";
