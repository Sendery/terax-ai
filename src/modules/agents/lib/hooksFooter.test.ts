import { describe, expect, it } from "vitest";
import { claudeHooksFooter } from "./hooksFooter";

describe("claudeHooksFooter", () => {
  it("offers to install when the hooks are absent", () => {
    // Absent is the state of every fresh install. Reporting it as a failure
    // put a red error in the panel before the user had touched anything.
    expect(
      claudeHooksFooter({ installed: false, installing: false, failed: false }),
    ).toEqual({ kind: "offer", error: false });
  });

  it("offers to install while the status is still unknown", () => {
    expect(
      claudeHooksFooter({ installed: null, installing: false, failed: false }),
    ).toEqual({ kind: "offer", error: false });
  });

  it("confirms once they are installed", () => {
    expect(
      claudeHooksFooter({ installed: true, installing: false, failed: false }),
    ).toEqual({ kind: "ready", error: false });
  });

  it("reports an error only after an install actually failed", () => {
    expect(
      claudeHooksFooter({ installed: false, installing: false, failed: true }),
    ).toEqual({ kind: "offer", error: true });
  });

  it("hides a previous failure while a retry is running", () => {
    expect(
      claudeHooksFooter({ installed: false, installing: true, failed: true }),
    ).toEqual({ kind: "installing", error: false });
  });
});
