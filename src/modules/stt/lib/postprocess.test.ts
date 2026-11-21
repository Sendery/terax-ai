import { describe, expect, it } from "vitest";
import {
  applyDictionary,
  applyMode,
  dictionaryContext,
  finishDictation,
  joinSegments,
  modeQuery,
  STT_CONTEXT_MAX_CHARS,
} from "./postprocess";

const DICTIONARY = [
  { written: "Pi-Terax", spoken: "Piterax" },
  { written: "Sendery", spoken: "Senderi" },
  { written: "Kokoro" },
  { written: "diff", spoken: "Difa" },
];

describe("applyDictionary", () => {
  it("replaces spoken forms and restores the written casing", () => {
    // Exactly what Rumble-2-Flash wrote for the test clip, with context.
    expect(
      applyDictionary(
        "Abre Terax, lanza kokoro en el panel de Senderi y pásale el Difa Piterax para que lo revise.",
        DICTIONARY,
      ),
    ).toBe(
      "Abre Terax, lanza Kokoro en el panel de Sendery y pásale el diff Pi-Terax para que lo revise.",
    );
  });

  it("ignores accents and case but only matches whole words", () => {
    const terms = [{ written: "Óscar" }, { written: "API" }];
    expect(applyDictionary("habla con oscar sobre la api", terms)).toBe(
      "habla con Óscar sobre la API",
    );
    expect(applyDictionary("rapido rapidamente", [{ written: "rápido" }])).toBe(
      "rápido rapidamente",
    );
    expect(applyDictionary("capital", [{ written: "API" }])).toBe("capital");
  });

  it("prefers the longest phrase and never overlaps", () => {
    const terms = [{ written: "Terax" }, { written: "Pi Terax Pro", spoken: "pi terax pro" }];
    expect(applyDictionary("usa pi terax pro y terax", terms)).toBe(
      "usa Pi Terax Pro y Terax",
    );
  });

  it("keeps the text when there is nothing to do", () => {
    expect(applyDictionary("hola", [])).toBe("hola");
    expect(applyDictionary("", DICTIONARY)).toBe("");
  });
});

describe("joinSegments", () => {
  it("joins in order, drops empty segments and fixes spacing", () => {
    expect(joinSegments(["Hola ,  qué tal.", "", "  Bien. "])).toBe("Hola, qué tal. Bien.");
    expect(joinSegments(["¿ Vienes ?"])).toBe("¿Vienes?");
  });
});

describe("applyMode", () => {
  const text = "Necesito que revises el fichero. Después abre una PR.";

  it("leaves Prompt and Minimal alone apart from spacing", () => {
    expect(applyMode(`  ${text} `, "prompt")).toBe(text);
    expect(applyMode(text, "minimal")).toBe(text);
  });

  it("Casual starts in lower case and drops one final period", () => {
    expect(applyMode(text, "casual")).toBe(
      "necesito que revises el fichero. Después abre una PR",
    );
    expect(applyMode("¿Vienes?", "casual")).toBe("¿vienes?");
    expect(applyMode("Espera...", "casual")).toBe("espera...");
    expect(applyMode("API caída.", "casual")).toBe("API caída");
    expect(applyMode("Kokoro va bien.", "casual", [{ written: "Kokoro" }])).toBe(
      "Kokoro va bien",
    );
  });

  it("Formal capitalises every sentence and closes the last one", () => {
    expect(applyMode("hola. qué tal? bien", "formal")).toBe("Hola. Qué tal? Bien.");
    expect(applyMode("¿vienes?", "formal")).toBe("¿Vienes?");
  });

  it("asks the model to keep repeated words only in Minimal", () => {
    expect(modeQuery("minimal")).toEqual({ filler: false, verbatim: true, digits: true });
    expect(modeQuery("prompt")).toEqual({ filler: false, verbatim: false, digits: true });
    expect(modeQuery("casual").verbatim).toBe(false);
  });
});

describe("finishDictation", () => {
  it("joins, applies the dictionary, then the style", () => {
    expect(
      finishDictation(["Lanza kokoro.", "Y avisa a Senderi."], "casual", DICTIONARY),
    ).toBe("lanza Kokoro. Y avisa a Sendery");
  });
});

describe("dictionaryContext", () => {
  it("lists written terms once, comma separated", () => {
    expect(dictionaryContext(DICTIONARY)).toBe("Pi-Terax, Sendery, Kokoro, diff");
    expect(dictionaryContext([{ written: "Kokoro" }, { written: "kokoro" }])).toBe("Kokoro");
  });

  it("stops at a whole term before the cap", () => {
    const many = Array.from({ length: 400 }, (_, i) => ({ written: `termino${i}` }));
    const context = dictionaryContext(many);
    expect(context.length).toBeLessThanOrEqual(STT_CONTEXT_MAX_CHARS);
    expect(context.endsWith(",")).toBe(false);
    expect(context.split(", ").every((t) => /^termino\d+$/.test(t))).toBe(true);
  });
});

describe("dictionary near misses", () => {
  const terms = [{ written: "Sendery" }, { written: "Kokoro" }, { written: "diff" }];

  it("corrects a long term heard one letter off", () => {
    expect(applyDictionary("el panel de Senderi", terms)).toBe("el panel de Sendery");
    expect(applyDictionary("lanza Kokorro ya", terms)).toBe("lanza Kokoro ya");
    expect(applyDictionary("lanza Kookro ya", terms)).toBe("lanza Kokoro ya");
  });

  it("leaves short terms, other initials, lower-case words and distant words alone", () => {
    expect(applyDictionary("un Dif rapido", terms)).toBe("un Dif rapido");
    expect(applyDictionary("Tenderi", terms)).toBe("Tenderi");
    expect(applyDictionary("un sendero corto", terms)).toBe("un sendero corto");
    expect(applyDictionary("Sendas", terms)).toBe("Sendas");
    expect(applyDictionary("Sender", terms)).toBe("Sendery");
  });
});
