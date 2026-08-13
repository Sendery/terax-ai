export const CAPTURE_TARGETS = [
  "window",
  "header",
  "sidebar",
  "tabstrip",
  "statusbar",
  "active-pane",
  "pane",
  "overlay",
  "agent-monitor",
] as const;

export type CaptureTarget = (typeof CAPTURE_TARGETS)[number];

export type CaptureRequest = {
  target: CaptureTarget;
  tabId?: number;
};

export type CaptureValidation =
  | { ok: true; value: CaptureRequest }
  | { ok: false; message: string };

type TabLike = { id: number; private?: boolean };

export function isCaptureTarget(value: unknown): value is CaptureTarget {
  return (
    typeof value === "string" &&
    CAPTURE_TARGETS.includes(value as CaptureTarget)
  );
}

export function validateCaptureRequest(input: unknown): CaptureValidation {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, message: "app.capture requires an object payload" };
  }
  const record = input as Record<string, unknown>;
  if (!isCaptureTarget(record.target)) {
    return {
      ok: false,
      message: `app.capture requires payload.target to be one of: ${CAPTURE_TARGETS.join(", ")}`,
    };
  }
  const target = record.target;
  if (target === "pane") {
    if (!Number.isInteger(record.tabId)) {
      return {
        ok: false,
        message:
          "app.capture requires an integer payload.tabId for pane captures",
      };
    }
    return { ok: true, value: { target, tabId: record.tabId as number } };
  }
  if (record.tabId !== undefined) {
    return {
      ok: false,
      message: "app.capture accepts payload.tabId only for pane captures",
    };
  }
  return { ok: true, value: { target } };
}

const WHOLE_WINDOW_TARGETS: readonly CaptureTarget[] = [
  "window",
  "tabstrip",
  "agent-monitor",
];

export function captureBlockReason(
  tabs: readonly TabLike[],
  activeTabId: number,
  request: CaptureRequest,
): string | null {
  if (request.target === "pane") {
    const tab = tabs.find((candidate) => candidate.id === request.tabId);
    if (!tab) return `Tab ${request.tabId} not found`;
    if (tab.private) {
      return "Capture refused: the requested pane is a private terminal";
    }
    return null;
  }
  if (WHOLE_WINDOW_TARGETS.includes(request.target)) {
    if (tabs.some((tab) => tab.private)) {
      return "Capture refused: a private terminal is open in this window";
    }
    return null;
  }
  const active = tabs.find((tab) => tab.id === activeTabId);
  if (active?.private) {
    return "Capture refused: the active tab is a private terminal";
  }
  return null;
}

export function captureTargetSelector(request: CaptureRequest): string {
  if (request.target === "pane") {
    return `[data-capture-target="pane"][data-capture-tab-id="${request.tabId}"]`;
  }
  return `[data-capture-target="${request.target}"]`;
}
