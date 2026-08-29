import { describe, expect, it } from "vitest";
import {
  addSequenceMessage,
  addSequenceParticipant,
  deleteSequenceParticipant,
  moveSequenceMessage,
  moveSequenceParticipant,
  parseSequenceVisualSource,
  type SequenceArrow,
  type SequenceParticipantKind,
  serializeSequenceVisualModel,
  updateSequenceMessage,
  updateSequenceParticipant,
} from "./sequenceModel";

function parsed(source: string) {
  const result = parseSequenceVisualSource(source);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  return result.model;
}

describe("parseSequenceVisualSource", () => {
  it("parses participants, aliases, implicit participants, and messages", () => {
    const model = parsed(`sequenceDiagram
  actor U as User
  participant DB@{ "type": "database", "alias": "Primary database" }
  U->>API: Request
  API-->>DB: Query: latest
  DB-->>U: Result`);

    expect(model.participants).toEqual([
      { id: "U", label: "User", kind: "actor" },
      { id: "DB", label: "Primary database", kind: "database" },
      { id: "API", label: "API", kind: "participant" },
    ]);
    expect(model.messages).toEqual([
      { id: "message1", from: "U", to: "API", text: "Request", arrow: "->>" },
      {
        id: "message2",
        from: "API",
        to: "DB",
        text: "Query: latest",
        arrow: "-->>",
      },
      { id: "message3", from: "DB", to: "U", text: "Result", arrow: "-->>" },
    ]);
  });

  it.each<SequenceParticipantKind>([
    "participant",
    "actor",
    "boundary",
    "control",
    "entity",
    "database",
    "collections",
    "queue",
  ])("round-trips the %s participant kind", (kind) => {
    const model = parsed(
      serializeSequenceVisualModel({
        kind: "sequence",
        participants: [{ id: "A", label: "Label", kind }],
        messages: [],
      }),
    );
    expect(model.participants[0]).toEqual({ id: "A", label: "Label", kind });
  });

  it.each<SequenceParticipantKind>([
    "boundary",
    "control",
    "entity",
    "database",
    "collections",
    "queue",
  ])("serializes the %s kind with Mermaid shape metadata", (kind) => {
    const source = serializeSequenceVisualModel({
      kind: "sequence",
      participants: [{ id: "A", label: "Label", kind }],
      messages: [],
    });

    expect(source).toBe(
      `sequenceDiagram\n  participant A@{ "type": "${kind}", "alias": "Label" }`,
    );
  });

  it.each<SequenceParticipantKind>(["participant", "actor"])(
    "serializes the %s kind with the plain declaration",
    (kind) => {
      const source = serializeSequenceVisualModel({
        kind: "sequence",
        participants: [{ id: "A", label: "Label", kind }],
        messages: [],
      });

      expect(source).toBe(`sequenceDiagram\n  ${kind} A as Label`);
    },
  );

  it("omits the alias when a shaped participant is unlabelled", () => {
    const source = serializeSequenceVisualModel({
      kind: "sequence",
      participants: [{ id: "DB", label: "DB", kind: "database" }],
      messages: [],
    });

    expect(source).toBe(
      'sequenceDiagram\n  participant DB@{ "type": "database" }',
    );
  });

  it("parses Mermaid shape metadata back into a participant kind", () => {
    const model = parsed(
      'sequenceDiagram\n  participant DB@{ "type": "database", "alias": "Store" }\n  DB->>DB: ping',
    );

    expect(model.participants[0]).toEqual({
      id: "DB",
      label: "Store",
      kind: "database",
    });
  });

  it("rejects a bare shape keyword because Mermaid does not accept it", () => {
    expect(parseSequenceVisualSource("sequenceDiagram\n  database DB").ok).toBe(
      false,
    );
  });

  it("keeps braces in participant labels out of the visual subset", () => {
    expect(
      parseSequenceVisualSource("sequenceDiagram\n  participant A as {x}").ok,
    ).toBe(false);
    expect(() =>
      serializeSequenceVisualModel({
        kind: "sequence",
        participants: [{ id: "A", label: "{x}", kind: "database" }],
        messages: [],
      }),
    ).toThrow(/plain single-line text/);
  });

  it.each<SequenceArrow>([
    "->",
    "-->",
    "->>",
    "-->>",
    "-x",
    "--x",
    "-)",
    "--)",
    "<<->>",
    "<<-->>",
  ])("round-trips %s messages", (arrow) => {
    const model = parsed(`sequenceDiagram\n  A${arrow}B: Hello`);
    expect(model.messages[0]).toMatchObject({ arrow, text: "Hello" });
    expect(serializeSequenceVisualModel(model)).toContain(`A${arrow}B: Hello`);
  });

  it.each([
    "sequenceDiagram\n  %% keep comment\n  A->>B: Hi",
    "sequenceDiagram\n  loop Retry\n  A->>B: Hi\n  end",
    "sequenceDiagram\n  alt Accepted\n  A->>B: Hi\n  end",
    "sequenceDiagram\n  Note over A: Important",
    "sequenceDiagram\n  activate A",
    "sequenceDiagram\n  autonumber",
    "sequenceDiagram\n  box Services\n  participant A\n  end",
  ])("rejects advanced source instead of rewriting it", (source) => {
    expect(parseSequenceVisualSource(source).ok).toBe(false);
  });

  it("rejects duplicate explicit participants instead of deduplicating them", () => {
    const result = parseSequenceVisualSource(
      "sequenceDiagram\n  participant A as Alice\n  participant A as Alice\n  A->>B: Hi",
    );

    expect(result).toEqual({
      ok: false,
      reason: "Duplicate sequence participant declaration: A",
    });
  });
});

describe("sequence visual mutations", () => {
  it("serializes a deterministic explicit participant model", () => {
    const source = serializeSequenceVisualModel(
      parsed("sequenceDiagram\n  B->>A: Hello"),
    );
    expect(source).toBe(`sequenceDiagram
  participant B
  participant A
  B->>A: Hello`);
  });

  it("adds, edits, and reorders participants while preserving references", () => {
    let model = parsed(
      "sequenceDiagram\n  participant participant1\n  A->>B: Hi",
    );
    model = addSequenceParticipant(model, {
      label: "Worker",
      kind: "control",
    });
    expect(model.participants[model.participants.length - 1]).toEqual({
      id: "participant2",
      label: "Worker",
      kind: "control",
    });

    model = updateSequenceParticipant(model, "participant2", {
      id: "W",
      label: "Worker service",
      kind: "entity",
    });
    model = addSequenceMessage(model, {
      from: "A",
      to: "W",
      text: "Run",
      arrow: "->>",
    });
    model = moveSequenceParticipant(model, "W", 0);

    expect(model.participants[0]).toEqual({
      id: "W",
      label: "Worker service",
      kind: "entity",
    });
    expect(model.messages[model.messages.length - 1]).toMatchObject({
      to: "W",
    });
  });

  it("deletes a participant and all related messages", () => {
    const model = deleteSequenceParticipant(
      parsed("sequenceDiagram\n  A->>B: One\n  B-->>C: Two\n  C->>A: Three"),
      "B",
    );
    expect(model.participants.map((participant) => participant.id)).toEqual([
      "A",
      "C",
    ]);
    expect(model.messages).toEqual([
      { id: "message3", from: "C", to: "A", text: "Three", arrow: "->>" },
    ]);
  });

  it("adds, edits, and reorders messages", () => {
    let model = parsed(
      "sequenceDiagram\n  participant A\n  participant B\n  participant C",
    );
    model = addSequenceMessage(model, {
      from: "A",
      to: "B",
      text: "First",
      arrow: "->>",
    });
    model = addSequenceMessage(model, {
      from: "B",
      to: "C",
      text: "Second",
      arrow: "-->>",
    });
    model = updateSequenceMessage(model, "message2", {
      from: "C",
      to: "A",
      text: "Updated",
      arrow: "-x",
    });
    model = moveSequenceMessage(model, "message2", 0);
    expect(model.messages.map((message) => message.id)).toEqual([
      "message2",
      "message1",
    ]);
    expect(model.messages[0]).toMatchObject({
      from: "C",
      to: "A",
      text: "Updated",
      arrow: "-x",
    });
  });

  it("round-trips generated source through the visual parser", () => {
    const source = serializeSequenceVisualModel(
      parsed(
        "sequenceDiagram\n  actor A as Alice\n  A->>B: Request\n  B-->>A: Result",
      ),
    );
    expect(parseSequenceVisualSource(source)).toEqual({
      ok: true,
      model: parsed(source),
    });
  });
});

describe("serializeSequenceVisualModel real Mermaid acceptance", () => {
  it.each<SequenceParticipantKind>([
    "participant",
    "actor",
    "boundary",
    "control",
    "entity",
    "database",
    "collections",
    "queue",
  ])("emits source Mermaid accepts for the %s kind", async (kind) => {
    const mermaid = (await import("mermaid")).default;
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });
    const source = serializeSequenceVisualModel({
      kind: "sequence",
      participants: [
        { id: "A", label: "Alpha", kind },
        { id: "B", label: "B", kind: "participant" },
      ],
      messages: [{ id: "m1", from: "A", to: "B", text: "Hello", arrow: "->>" }],
    });

    await expect(mermaid.parse(source)).resolves.toBeTruthy();
  });
});
