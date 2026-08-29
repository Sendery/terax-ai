export type SequenceParticipantKind =
  | "participant"
  | "actor"
  | "boundary"
  | "control"
  | "entity"
  | "database"
  | "collections"
  | "queue";

export type SequenceArrow =
  | "->"
  | "-->"
  | "->>"
  | "-->>"
  | "-x"
  | "--x"
  | "-)"
  | "--)"
  | "<<->>"
  | "<<-->>";

export type SequenceParticipant = {
  id: string;
  label: string;
  kind: SequenceParticipantKind;
};

export type SequenceMessage = {
  id: string;
  from: string;
  to: string;
  text: string;
  arrow: SequenceArrow;
};

export type SequenceVisualModel = {
  kind: "sequence";
  participants: SequenceParticipant[];
  messages: SequenceMessage[];
};

export type SequenceParseResult =
  | { ok: true; model: SequenceVisualModel }
  | { ok: false; reason: string };

const SEQUENCE_ID = /^[A-Za-z][A-Za-z0-9_-]*$/;
const PARTICIPANT_KINDS = new Set<SequenceParticipantKind>([
  "participant",
  "actor",
  "boundary",
  "control",
  "entity",
  "database",
  "collections",
  "queue",
]);
const SEQUENCE_ARROWS: SequenceArrow[] = [
  "<<-->>",
  "<<->>",
  "-->>",
  "-->",
  "--x",
  "--)",
  "->>",
  "->",
  "-x",
  "-)",
];
const ARROWS = new Set<SequenceArrow>(SEQUENCE_ARROWS);

function assertId(id: string): void {
  if (!SEQUENCE_ID.test(id)) {
    throw new Error(`Invalid sequence participant id: ${id}`);
  }
}

function assertText(value: string, field: string): void {
  if (!value.trim() || /[<>;\r\n]/.test(value)) {
    throw new Error(`${field} must be plain single-line text`);
  }
}

// Shaped participants are serialized as `participant Id@{ ... }`. Mermaid's
// lexer ends that block at the first closing brace even inside a JSON string,
// so a braced label stays outside the visual subset.
function assertParticipantLabel(value: string): void {
  assertText(value, "Participant label");
  if (/[{}]/.test(value)) {
    throw new Error("Participant label must be plain single-line text");
  }
}

// Mermaid only accepts `participant` and `actor` as declaration keywords. Every
// other supported kind is a shape carried by the `@{ "type": ... }` metadata
// block, which is also where its alias lives.
const SHAPED_PARTICIPANT_KINDS = new Set<SequenceParticipantKind>([
  "boundary",
  "control",
  "entity",
  "database",
  "collections",
  "queue",
]);

function parseShapedParticipantLine(line: string): SequenceParticipant | null {
  const match = line.match(
    /^participant\s+([A-Za-z][A-Za-z0-9_-]*)@(\{[^{}]*\})$/,
  );
  if (!match) return null;
  const id = match[1];
  let metadata: unknown;
  try {
    metadata = JSON.parse(match[2]);
  } catch {
    return null;
  }
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }
  const entries = metadata as Record<string, unknown>;
  const extra = Object.keys(entries).filter(
    (key) => key !== "type" && key !== "alias",
  );
  if (extra.length > 0) return null;
  const kind = entries.type;
  if (typeof kind !== "string") return null;
  if (!SHAPED_PARTICIPANT_KINDS.has(kind as SequenceParticipantKind)) {
    return null;
  }
  const alias = entries.alias;
  if (alias !== undefined && typeof alias !== "string") return null;
  const label = alias?.trim() || id;
  if (/[<>;{}\r\n]/.test(label)) return null;
  return { id, label, kind: kind as SequenceParticipantKind };
}

function parseParticipantLine(line: string): SequenceParticipant | null {
  const shaped = parseShapedParticipantLine(line);
  if (shaped) return shaped;
  const match = line.match(
    /^(participant|actor)\s+([A-Za-z][A-Za-z0-9_-]*)(?:\s+as\s+(.+))?$/i,
  );
  if (!match) return null;
  const kind = match[1].toLowerCase() as SequenceParticipantKind;
  if (!PARTICIPANT_KINDS.has(kind)) return null;
  const id = match[2];
  const label = match[3]?.trim() || id;
  if (/[<>;{}\r\n]/.test(label)) return null;
  return { id, label, kind };
}

function parseMessageLine(line: string): Omit<SequenceMessage, "id"> | null {
  const separator = line.indexOf(":");
  if (separator < 0) return null;
  const statement = line.slice(0, separator).trim();
  const text = line.slice(separator + 1).trim();
  if (!text || /[<>;\r\n]/.test(text)) return null;

  for (const arrow of SEQUENCE_ARROWS) {
    const arrowIndex = statement.indexOf(arrow);
    if (arrowIndex < 0) continue;
    const from = statement.slice(0, arrowIndex).trim();
    const to = statement.slice(arrowIndex + arrow.length).trim();
    if (SEQUENCE_ID.test(from) && SEQUENCE_ID.test(to)) {
      return { from, to, text, arrow };
    }
  }
  return null;
}

export function parseSequenceVisualSource(source: string): SequenceParseResult {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  if (lines.shift()?.trim() !== "sequenceDiagram") {
    return {
      ok: false,
      reason: "Visual sequence editing requires a sequenceDiagram header",
    };
  }

  const participants: SequenceParticipant[] = [];
  const participantIndex = new Map<string, number>();
  const explicitParticipants = new Set<string>();
  let duplicateExplicitParticipantId: string | null = null;
  const messages: SequenceMessage[] = [];

  const addParticipant = (
    participant: SequenceParticipant,
    explicit: boolean,
  ): boolean => {
    const existingIndex = participantIndex.get(participant.id);
    if (existingIndex === undefined) {
      participantIndex.set(participant.id, participants.length);
      participants.push(participant);
      if (explicit) explicitParticipants.add(participant.id);
      return true;
    }
    if (!explicit) return true;
    if (explicitParticipants.has(participant.id)) {
      duplicateExplicitParticipantId = participant.id;
      return false;
    }
    participants[existingIndex] = participant;
    explicitParticipants.add(participant.id);
    return true;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("%%")) {
      return { ok: false, reason: "Comments and directives are Source-only" };
    }

    const participant = parseParticipantLine(line);
    if (participant) {
      if (!addParticipant(participant, true)) {
        return {
          ok: false,
          reason: duplicateExplicitParticipantId
            ? `Duplicate sequence participant declaration: ${duplicateExplicitParticipantId}`
            : `Conflicting participant declaration: ${participant.id}`,
        };
      }
      continue;
    }

    const message = parseMessageLine(line);
    if (!message) {
      return { ok: false, reason: `Unsupported sequence statement: ${line}` };
    }
    addParticipant(
      { id: message.from, label: message.from, kind: "participant" },
      false,
    );
    addParticipant(
      { id: message.to, label: message.to, kind: "participant" },
      false,
    );
    messages.push({ id: `message${messages.length + 1}`, ...message });
  }

  return {
    ok: true,
    model: { kind: "sequence", participants, messages },
  };
}

export function serializeSequenceVisualModel(
  model: SequenceVisualModel,
): string {
  const lines = ["sequenceDiagram"];
  const ids = new Set<string>();
  for (const participant of model.participants) {
    assertId(participant.id);
    assertParticipantLabel(participant.label);
    if (!PARTICIPANT_KINDS.has(participant.kind)) {
      throw new Error(`Unsupported participant kind: ${participant.kind}`);
    }
    if (ids.has(participant.id)) {
      throw new Error(`Duplicate sequence participant: ${participant.id}`);
    }
    ids.add(participant.id);
    if (SHAPED_PARTICIPANT_KINDS.has(participant.kind)) {
      const alias =
        participant.label === participant.id
          ? ""
          : `, "alias": ${JSON.stringify(participant.label)}`;
      lines.push(
        `  participant ${participant.id}@{ "type": ${JSON.stringify(participant.kind)}${alias} }`,
      );
    } else {
      const alias =
        participant.label === participant.id ? "" : ` as ${participant.label}`;
      lines.push(`  ${participant.kind} ${participant.id}${alias}`);
    }
  }
  for (const message of model.messages) {
    if (!ids.has(message.from) || !ids.has(message.to)) {
      throw new Error("Sequence message references an unknown participant");
    }
    assertText(message.text, "Message text");
    if (!ARROWS.has(message.arrow)) {
      throw new Error(`Unsupported sequence arrow: ${message.arrow}`);
    }
    lines.push(
      `  ${message.from}${message.arrow}${message.to}: ${message.text}`,
    );
  }
  return lines.join("\n");
}

function nextId(prefix: string, used: Set<string>): string {
  let index = 1;
  while (used.has(`${prefix}${index}`)) index += 1;
  return `${prefix}${index}`;
}

function moveItem<T>(items: T[], from: number, requestedTo: number): T[] {
  if (from < 0 || items.length < 2) return items;
  const to = Math.max(0, Math.min(requestedTo, items.length - 1));
  if (from === to) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export function addSequenceParticipant(
  model: SequenceVisualModel,
  participant: Pick<SequenceParticipant, "label" | "kind"> & { id?: string },
): SequenceVisualModel {
  const id =
    participant.id ??
    nextId("participant", new Set(model.participants.map((item) => item.id)));
  assertId(id);
  assertText(participant.label, "Participant label");
  if (model.participants.some((item) => item.id === id)) {
    throw new Error(`Sequence participant already exists: ${id}`);
  }
  return {
    ...model,
    participants: [...model.participants, { ...participant, id }],
  };
}

export function updateSequenceParticipant(
  model: SequenceVisualModel,
  participantId: string,
  patch: Partial<Pick<SequenceParticipant, "id" | "label" | "kind">>,
): SequenceVisualModel {
  const current = model.participants.find((item) => item.id === participantId);
  if (!current)
    throw new Error(`Unknown sequence participant: ${participantId}`);
  const next = { ...current, ...patch };
  assertId(next.id);
  assertText(next.label, "Participant label");
  if (
    next.id !== participantId &&
    model.participants.some((item) => item.id === next.id)
  ) {
    throw new Error(`Sequence participant already exists: ${next.id}`);
  }
  return {
    ...model,
    participants: model.participants.map((item) =>
      item.id === participantId ? next : item,
    ),
    messages: model.messages.map((message) => ({
      ...message,
      from: message.from === participantId ? next.id : message.from,
      to: message.to === participantId ? next.id : message.to,
    })),
  };
}

export function deleteSequenceParticipant(
  model: SequenceVisualModel,
  participantId: string,
): SequenceVisualModel {
  return {
    ...model,
    participants: model.participants.filter(
      (item) => item.id !== participantId,
    ),
    messages: model.messages.filter(
      (message) =>
        message.from !== participantId && message.to !== participantId,
    ),
  };
}

export function moveSequenceParticipant(
  model: SequenceVisualModel,
  participantId: string,
  toIndex: number,
): SequenceVisualModel {
  return {
    ...model,
    participants: moveItem(
      model.participants,
      model.participants.findIndex((item) => item.id === participantId),
      toIndex,
    ),
  };
}

export function addSequenceMessage(
  model: SequenceVisualModel,
  message: Omit<SequenceMessage, "id"> & { id?: string },
): SequenceVisualModel {
  if (
    !model.participants.some((item) => item.id === message.from) ||
    !model.participants.some((item) => item.id === message.to)
  ) {
    throw new Error("Sequence message references an unknown participant");
  }
  assertText(message.text, "Message text");
  const id =
    message.id ??
    nextId("message", new Set(model.messages.map((item) => item.id)));
  if (model.messages.some((item) => item.id === id)) {
    throw new Error(`Sequence message already exists: ${id}`);
  }
  return { ...model, messages: [...model.messages, { ...message, id }] };
}

export function updateSequenceMessage(
  model: SequenceVisualModel,
  messageId: string,
  patch: Partial<Omit<SequenceMessage, "id">>,
): SequenceVisualModel {
  const current = model.messages.find((item) => item.id === messageId);
  if (!current) throw new Error(`Unknown sequence message: ${messageId}`);
  const next = { ...current, ...patch };
  if (
    !model.participants.some((item) => item.id === next.from) ||
    !model.participants.some((item) => item.id === next.to)
  ) {
    throw new Error("Sequence message references an unknown participant");
  }
  assertText(next.text, "Message text");
  return {
    ...model,
    messages: model.messages.map((item) =>
      item.id === messageId ? next : item,
    ),
  };
}

export function deleteSequenceMessage(
  model: SequenceVisualModel,
  messageId: string,
): SequenceVisualModel {
  return {
    ...model,
    messages: model.messages.filter((item) => item.id !== messageId),
  };
}

export function moveSequenceMessage(
  model: SequenceVisualModel,
  messageId: string,
  toIndex: number,
): SequenceVisualModel {
  return {
    ...model,
    messages: moveItem(
      model.messages,
      model.messages.findIndex((item) => item.id === messageId),
      toIndex,
    ),
  };
}
