import { describe, expect, it } from "vitest";
import type { Tab } from "@/modules/tabs";
import { docShownBy, pickDefaultDoc, titleFromText } from "./readerCommands";

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

describe("docShownBy", () => {
  it("reads a Reader tab's document and a panel's document", () => {
    const reader = { id: 1, kind: "reader", docId: "a" } as Tab;
    const terminal = {
      id: 2,
      kind: "terminal",
      readerDock: { docId: "b", height: 0.4 },
    } as Tab;
    const library = {
      id: 3,
      kind: "terminal",
      readerDock: { docId: null, height: 0.4 },
    } as Tab;
    expect(docShownBy(reader)).toBe("a");
    expect(docShownBy(terminal)).toBe("b");
    expect(docShownBy(library)).toBeNull();
    expect(docShownBy(undefined)).toBeNull();
  });
});

describe("titleFromText", () => {
  it("names untitled text after its first words", () => {
    expect(titleFromText("# Notas de prueba\n\nTexto.")).toBe("Notas de prueba");
    expect(titleFromText("\n- uno dos tres cuatro cinco seis siete")).toBe(
      "uno dos tres cuatro cinco seis...",
    );
    expect(titleFromText("   \n  ")).toBeUndefined();
  });
});
