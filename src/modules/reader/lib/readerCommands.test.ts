import { describe, expect, it } from "vitest";
import { pickDefaultDoc } from "./readerCommands";

describe("pickDefaultDoc", () => {
  it("prefers the document that is sounding", () => {
    expect(pickDefaultDoc({ docId: "a", phase: "playing" }, "b")).toBe("a");
    expect(pickDefaultDoc({ docId: "a", phase: "gap" }, "b")).toBe("a");
  });

  it("prefers the tab on screen over a paused reading", () => {
    expect(pickDefaultDoc({ docId: "a", phase: "paused" }, "b")).toBe("b");
  });

  it("falls back to the paused reading, else nothing", () => {
    expect(pickDefaultDoc({ docId: "a", phase: "paused" }, null)).toBe("a");
    expect(pickDefaultDoc({ docId: null, phase: "idle" }, null)).toBeNull();
  });
});
