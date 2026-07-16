import { describe, expect, it } from "vitest";
import {
  CAPTURE_TARGETS,
  captureBlockReason,
  captureTargetSelector,
  isCaptureTarget,
  validateCaptureRequest,
} from "./targets";

const tabs = [
  { id: 1, private: false },
  { id: 2, private: true },
  { id: 3, private: false },
];

const noPrivate = [
  { id: 1, private: false },
  { id: 3, private: false },
];

describe("isCaptureTarget", () => {
  it("accepts every closed target id", () => {
    for (const target of CAPTURE_TARGETS) {
      expect(isCaptureTarget(target)).toBe(true);
    }
  });

  it("rejects arbitrary strings and non-strings", () => {
    expect(isCaptureTarget("body")).toBe(false);
    expect(isCaptureTarget("#root")).toBe(false);
    expect(isCaptureTarget(1)).toBe(false);
    expect(isCaptureTarget(undefined)).toBe(false);
  });
});

describe("validateCaptureRequest", () => {
  it("accepts a plain window capture", () => {
    expect(validateCaptureRequest({ target: "window" })).toEqual({
      ok: true,
      value: { target: "window" },
    });
  });

  it("requires tabId for pane captures", () => {
    const result = validateCaptureRequest({ target: "pane" });
    expect(result.ok).toBe(false);
  });

  it("accepts pane with integer tabId", () => {
    expect(validateCaptureRequest({ target: "pane", tabId: 3 })).toEqual({
      ok: true,
      value: { target: "pane", tabId: 3 },
    });
  });

  it("rejects tabId on non-pane targets", () => {
    expect(validateCaptureRequest({ target: "sidebar", tabId: 3 }).ok).toBe(
      false,
    );
  });

  it("rejects unknown targets and malformed payloads", () => {
    expect(validateCaptureRequest({ target: "desktop" }).ok).toBe(false);
    expect(validateCaptureRequest(null).ok).toBe(false);
    expect(validateCaptureRequest({ target: "pane", tabId: 1.5 }).ok).toBe(
      false,
    );
  });
});

describe("captureBlockReason", () => {
  it("blocks window and tabstrip when any private terminal exists", () => {
    expect(captureBlockReason(tabs, 1, { target: "window" })).toMatch(
      /private/i,
    );
    expect(captureBlockReason(tabs, 1, { target: "tabstrip" })).toMatch(
      /private/i,
    );
  });

  it("allows window capture without private terminals", () => {
    expect(captureBlockReason(noPrivate, 1, { target: "window" })).toBeNull();
  });

  it("blocks pane capture of a private tab, allows others", () => {
    expect(captureBlockReason(tabs, 1, { target: "pane", tabId: 2 })).toMatch(
      /private/i,
    );
    expect(
      captureBlockReason(tabs, 1, { target: "pane", tabId: 3 }),
    ).toBeNull();
  });

  it("reports a missing pane tab", () => {
    expect(captureBlockReason(tabs, 1, { target: "pane", tabId: 99 })).toMatch(
      /not found/i,
    );
  });

  it("blocks active-scoped targets only when the active tab is private", () => {
    expect(captureBlockReason(tabs, 2, { target: "active-pane" })).toMatch(
      /private/i,
    );
    expect(captureBlockReason(tabs, 2, { target: "statusbar" })).toMatch(
      /private/i,
    );
    expect(captureBlockReason(tabs, 1, { target: "active-pane" })).toBeNull();
    expect(captureBlockReason(tabs, 1, { target: "sidebar" })).toBeNull();
    expect(captureBlockReason(tabs, 1, { target: "overlay" })).toBeNull();
  });
});

describe("captureTargetSelector", () => {
  it("builds attribute selectors from the closed set", () => {
    expect(captureTargetSelector({ target: "sidebar" })).toBe(
      '[data-capture-target="sidebar"]',
    );
    expect(captureTargetSelector({ target: "pane", tabId: 3 })).toBe(
      '[data-capture-target="pane"][data-capture-tab-id="3"]',
    );
  });
});
