import {
  CSS,
  closestCenter,
  DndContext,
  type DragEndEvent,
  horizontalListSortingStrategy,
  KeyboardSensor,
  PointerSensor,
  SortableContext,
  sortableKeyboardCoordinates,
  useSensor,
  useSensors,
  useSortable,
  verticalListSortingStrategy,
} from "@/modules/dnd";
import {
  addSequenceMessage,
  addSequenceParticipant,
  deleteSequenceMessage,
  deleteSequenceParticipant,
  moveSequenceMessage,
  moveSequenceParticipant,
  type SequenceArrow,
  type SequenceMessage,
  type SequenceParticipant,
  type SequenceParticipantKind,
  updateSequenceMessage,
  updateSequenceParticipant,
} from "@/modules/mermaid/lib/sequenceModel";
import type { SequenceVisualDocument } from "@/modules/mermaid/lib/visualDocument";
import { type FormEvent, type JSX, useState } from "react";

const PARTICIPANT_KINDS: SequenceParticipantKind[] = [
  "participant",
  "actor",
  "boundary",
  "control",
  "entity",
  "database",
  "collections",
  "queue",
];

const MESSAGE_ARROWS: SequenceArrow[] = [
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
];

const inputClass =
  "h-8 min-w-0 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary/60 focus:ring-2 focus:ring-primary/20";
const secondaryButtonClass =
  "h-7 rounded-md border border-border bg-background px-2 text-[11px] font-medium text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40 disabled:pointer-events-none disabled:opacity-35";
const primaryButtonClass =
  "h-8 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary/50 disabled:pointer-events-none disabled:opacity-40";

function participantDragId(id: string): string {
  return `participant:${id}`;
}

function messageDragId(id: string): string {
  return `message:${id}`;
}

function errorText(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "The change could not be saved";
}

function plural(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

function Field({
  label,
  children,
}: {
  label: string;
  children: JSX.Element;
}): JSX.Element {
  return (
    <div className="flex min-w-0 flex-col gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
      <span>{label}</span>
      {children}
    </div>
  );
}

function FormActions({
  submitLabel,
  onCancel,
}: {
  submitLabel: string;
  onCancel: () => void;
}): JSX.Element {
  return (
    <div className="flex items-center justify-end gap-1.5 pt-1">
      <button type="button" className={secondaryButtonClass} onClick={onCancel}>
        Cancel
      </button>
      <button type="submit" className={primaryButtonClass}>
        {submitLabel}
      </button>
    </div>
  );
}

function FormError({ message }: { message: string }): JSX.Element | null {
  if (!message) return null;
  return (
    <p role="alert" className="text-[11px] text-destructive">
      {message}
    </p>
  );
}

type ParticipantDraft = Pick<SequenceParticipant, "id" | "label" | "kind">;

type ParticipantCardProps = {
  participant: SequenceParticipant;
  index: number;
  total: number;
  relatedMessageCount: number;
  onSave: (participantId: string, draft: ParticipantDraft) => void;
  onDelete: (participantId: string) => void;
  onMove: (participantId: string, toIndex: number) => void;
};

function ParticipantCard({
  participant,
  index,
  total,
  relatedMessageCount,
  onSave,
  onDelete,
  onMove,
}: ParticipantCardProps): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ParticipantDraft>(participant);
  const [error, setError] = useState("");
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: participantDragId(participant.id),
    disabled: editing,
  });
  const deleteLabel = `Delete ${participant.label} and ${plural(
    relatedMessageCount,
    "related message",
  )}`;

  const beginEditing = () => {
    setDraft(participant);
    setError("");
    setEditing(true);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      onSave(participant.id, {
        id: draft.id.trim(),
        label: draft.label.trim(),
        kind: draft.kind,
      });
      setError("");
      setEditing(false);
    } catch (saveError) {
      setError(errorText(saveError));
    }
  };

  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
      }}
      className={`w-64 shrink-0 rounded-lg border bg-card p-3 shadow-sm ${
        isDragging ? "z-10 opacity-50" : "border-border/70"
      }`}
    >
      {editing ? (
        <form className="flex flex-col gap-2" onSubmit={submit}>
          <Field label="Identifier">
            <input
              className={inputClass}
              value={draft.id}
              required
              pattern="[A-Za-z][A-Za-z0-9_-]*"
              aria-label={`Identifier for ${participant.label}`}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  id: event.target.value,
                }))
              }
            />
          </Field>
          <Field label="Label">
            <input
              className={inputClass}
              value={draft.label}
              required
              aria-label={`Label for ${participant.id}`}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  label: event.target.value,
                }))
              }
            />
          </Field>
          <Field label="Kind">
            <select
              className={inputClass}
              value={draft.kind}
              aria-label={`Kind for ${participant.label}`}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  kind: event.target.value as SequenceParticipantKind,
                }))
              }
            >
              {PARTICIPANT_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {kind}
                </option>
              ))}
            </select>
          </Field>
          <FormError message={error} />
          <FormActions
            submitLabel="Save participant"
            onCancel={() => {
              setError("");
              setEditing(false);
            }}
          />
        </form>
      ) : (
        <>
          <div className="flex items-start gap-2">
            <button
              type="button"
              {...attributes}
              {...listeners}
              aria-label={`Drag ${participant.label} to reorder`}
              title="Drag to reorder. Keyboard: Space, arrow keys, Space."
              className="mt-0.5 cursor-grab rounded border border-border bg-muted/40 px-1.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground outline-none active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-primary/40"
              style={{ touchAction: "none" }}
            >
              Drag
            </button>
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-sm font-semibold text-foreground">
                {participant.label}
              </h3>
              <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                {participant.kind} {participant.id}
              </p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-1">
            <button
              type="button"
              className={secondaryButtonClass}
              aria-label={`Move ${participant.label} left`}
              disabled={index === 0}
              onClick={() => onMove(participant.id, index - 1)}
            >
              Left
            </button>
            <button
              type="button"
              className={secondaryButtonClass}
              aria-label={`Move ${participant.label} right`}
              disabled={index === total - 1}
              onClick={() => onMove(participant.id, index + 1)}
            >
              Right
            </button>
            <span className="min-w-1 flex-1" />
            <button
              type="button"
              className={secondaryButtonClass}
              aria-label={`Edit ${participant.label}`}
              onClick={beginEditing}
            >
              Edit
            </button>
            <button
              type="button"
              className={`${secondaryButtonClass} text-destructive hover:text-destructive`}
              aria-label={deleteLabel}
              aria-describedby="participant-delete-note"
              title={deleteLabel}
              onClick={() => onDelete(participant.id)}
            >
              Delete
            </button>
          </div>
        </>
      )}
    </li>
  );
}

function AddParticipantForm({
  onAdd,
  onCancel,
}: {
  onAdd: (draft: ParticipantDraft) => void;
  onCancel: () => void;
}): JSX.Element {
  const [draft, setDraft] = useState<ParticipantDraft>({
    id: "",
    label: "",
    kind: "participant",
  });
  const [error, setError] = useState("");

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      onAdd({
        id: draft.id.trim(),
        label: draft.label.trim(),
        kind: draft.kind,
      });
      setError("");
    } catch (saveError) {
      setError(errorText(saveError));
    }
  };

  return (
    <form
      className="mt-3 grid gap-2 rounded-lg border border-border/70 bg-muted/20 p-3 sm:grid-cols-3"
      onSubmit={submit}
    >
      <Field label="Identifier">
        <input
          className={inputClass}
          value={draft.id}
          required
          pattern="[A-Za-z][A-Za-z0-9_-]*"
          placeholder="Service"
          aria-label="Participant identifier"
          onChange={(event) =>
            setDraft((current) => ({ ...current, id: event.target.value }))
          }
        />
      </Field>
      <Field label="Label">
        <input
          className={inputClass}
          value={draft.label}
          required
          placeholder="Service label"
          aria-label="Participant label"
          onChange={(event) =>
            setDraft((current) => ({ ...current, label: event.target.value }))
          }
        />
      </Field>
      <Field label="Kind">
        <select
          className={inputClass}
          value={draft.kind}
          aria-label="Participant kind"
          onChange={(event) =>
            setDraft((current) => ({
              ...current,
              kind: event.target.value as SequenceParticipantKind,
            }))
          }
        >
          {PARTICIPANT_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {kind}
            </option>
          ))}
        </select>
      </Field>
      <div className="sm:col-span-3">
        <FormError message={error} />
        <FormActions submitLabel="Add participant" onCancel={onCancel} />
      </div>
    </form>
  );
}

type MessageDraft = Pick<SequenceMessage, "from" | "to" | "text" | "arrow">;

type MessageFieldsProps = {
  draft: MessageDraft;
  participants: SequenceParticipant[];
  idPrefix: string;
  onChange: (draft: MessageDraft) => void;
};

function MessageFields({
  draft,
  participants,
  idPrefix,
  onChange,
}: MessageFieldsProps): JSX.Element {
  return (
    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
      <Field label="From">
        <select
          id={`${idPrefix}-from`}
          className={inputClass}
          value={draft.from}
          aria-label="From participant"
          onChange={(event) => onChange({ ...draft, from: event.target.value })}
        >
          {participants.map((participant) => (
            <option key={participant.id} value={participant.id}>
              {participant.label} ({participant.id})
            </option>
          ))}
        </select>
      </Field>
      <Field label="Arrow">
        <select
          id={`${idPrefix}-arrow`}
          className={`${inputClass} font-mono`}
          value={draft.arrow}
          aria-label="Message arrow"
          onChange={(event) =>
            onChange({ ...draft, arrow: event.target.value as SequenceArrow })
          }
        >
          {MESSAGE_ARROWS.map((arrow) => (
            <option key={arrow} value={arrow}>
              {arrow}
            </option>
          ))}
        </select>
      </Field>
      <Field label="To">
        <select
          id={`${idPrefix}-to`}
          className={inputClass}
          value={draft.to}
          aria-label="To participant"
          onChange={(event) => onChange({ ...draft, to: event.target.value })}
        >
          {participants.map((participant) => (
            <option key={participant.id} value={participant.id}>
              {participant.label} ({participant.id})
            </option>
          ))}
        </select>
      </Field>
      <div className="sm:col-span-3">
        <Field label="Message text">
          <input
            id={`${idPrefix}-text`}
            className={`${inputClass} w-full`}
            value={draft.text}
            required
            placeholder="Describe the message"
            aria-label="Message text"
            onChange={(event) =>
              onChange({ ...draft, text: event.target.value })
            }
          />
        </Field>
      </div>
    </div>
  );
}

type MessageCardProps = {
  message: SequenceMessage;
  participants: SequenceParticipant[];
  index: number;
  total: number;
  onSave: (messageId: string, draft: MessageDraft) => void;
  onDelete: (messageId: string) => void;
  onMove: (messageId: string, toIndex: number) => void;
};

function MessageCard({
  message,
  participants,
  index,
  total,
  onSave,
  onDelete,
  onMove,
}: MessageCardProps): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<MessageDraft>(message);
  const [error, setError] = useState("");
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: messageDragId(message.id), disabled: editing });
  const participantLabels = new Map(
    participants.map((participant) => [participant.id, participant.label]),
  );

  const beginEditing = () => {
    setDraft(message);
    setError("");
    setEditing(true);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      onSave(message.id, { ...draft, text: draft.text.trim() });
      setError("");
      setEditing(false);
    } catch (saveError) {
      setError(errorText(saveError));
    }
  };

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`rounded-lg border bg-card p-3 shadow-sm ${
        isDragging ? "z-10 opacity-50" : "border-border/70"
      }`}
    >
      {editing ? (
        <form className="flex flex-col gap-2" onSubmit={submit}>
          <MessageFields
            draft={draft}
            participants={participants}
            idPrefix={`edit-${message.id}`}
            onChange={setDraft}
          />
          <FormError message={error} />
          <FormActions
            submitLabel="Save message"
            onCancel={() => {
              setError("");
              setEditing(false);
            }}
          />
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            {...attributes}
            {...listeners}
            aria-label={`Drag ${message.text} to reorder`}
            title="Drag to reorder. Keyboard: Space, arrow keys, Space."
            className="cursor-grab rounded border border-border bg-muted/40 px-1.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground outline-none active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-primary/40"
            style={{ touchAction: "none" }}
          >
            Drag
          </button>
          <div className="min-w-40 flex-1">
            <h3 className="truncate text-xs font-semibold text-foreground">
              {message.text}
            </h3>
            <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
              {participantLabels.get(message.from) ?? message.from}{" "}
              <code className="font-mono text-foreground/75">
                {message.arrow}
              </code>{" "}
              {participantLabels.get(message.to) ?? message.to}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <button
              type="button"
              className={secondaryButtonClass}
              aria-label={`Move ${message.text} up`}
              disabled={index === 0}
              onClick={() => onMove(message.id, index - 1)}
            >
              Up
            </button>
            <button
              type="button"
              className={secondaryButtonClass}
              aria-label={`Move ${message.text} down`}
              disabled={index === total - 1}
              onClick={() => onMove(message.id, index + 1)}
            >
              Down
            </button>
            <button
              type="button"
              className={secondaryButtonClass}
              aria-label={`Edit ${message.text}`}
              onClick={beginEditing}
            >
              Edit
            </button>
            <button
              type="button"
              className={`${secondaryButtonClass} text-destructive hover:text-destructive`}
              aria-label={`Delete ${message.text}`}
              onClick={() => onDelete(message.id)}
            >
              Delete
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

function AddMessageForm({
  participants,
  onAdd,
  onCancel,
}: {
  participants: SequenceParticipant[];
  onAdd: (draft: MessageDraft) => void;
  onCancel: () => void;
}): JSX.Element {
  const firstParticipant = participants[0]?.id ?? "";
  const [draft, setDraft] = useState<MessageDraft>({
    from: firstParticipant,
    to: participants[1]?.id ?? firstParticipant,
    text: "",
    arrow: "->>",
  });
  const [error, setError] = useState("");

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      onAdd({ ...draft, text: draft.text.trim() });
      setError("");
    } catch (saveError) {
      setError(errorText(saveError));
    }
  };

  return (
    <form
      className="mt-3 flex flex-col gap-2 rounded-lg border border-border/70 bg-muted/20 p-3"
      onSubmit={submit}
    >
      <MessageFields
        draft={draft}
        participants={participants}
        idPrefix="add-message"
        onChange={setDraft}
      />
      <FormError message={error} />
      <FormActions submitLabel="Add message" onCancel={onCancel} />
    </form>
  );
}

export function SequenceVisualEditor(props: {
  document: SequenceVisualDocument;
  onCommit: (document: SequenceVisualDocument) => void;
}): JSX.Element {
  const { document, onCommit } = props;
  const { participants, messages } = document.model;
  const [showAddParticipant, setShowAddParticipant] = useState(false);
  const [showAddMessage, setShowAddMessage] = useState(false);
  const [status, setStatus] = useState("");
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const commit = (model: SequenceVisualDocument["model"]) => {
    onCommit({ ...document, model });
  };

  const moveParticipant = (participantId: string, toIndex: number) => {
    const participant = participants.find((item) => item.id === participantId);
    if (!participant) return;
    commit(moveSequenceParticipant(document.model, participantId, toIndex));
    setStatus(`${participant.label} moved to position ${toIndex + 1}.`);
  };

  const moveMessage = (messageId: string, toIndex: number) => {
    const message = messages.find((item) => item.id === messageId);
    if (!message) return;
    commit(moveSequenceMessage(document.model, messageId, toIndex));
    setStatus(`${message.text} moved to position ${toIndex + 1}.`);
  };

  const participantDragEnd = (event: DragEndEvent) => {
    if (!event.over || event.active.id === event.over.id) return;
    const participantId = String(event.active.id).replace(/^participant:/, "");
    const overId = String(event.over.id).replace(/^participant:/, "");
    const toIndex = participants.findIndex((item) => item.id === overId);
    if (toIndex >= 0) moveParticipant(participantId, toIndex);
  };

  const messageDragEnd = (event: DragEndEvent) => {
    if (!event.over || event.active.id === event.over.id) return;
    const messageId = String(event.active.id).replace(/^message:/, "");
    const overId = String(event.over.id).replace(/^message:/, "");
    const toIndex = messages.findIndex((item) => item.id === overId);
    if (toIndex >= 0) moveMessage(messageId, toIndex);
  };

  return (
    <section
      className="h-full overflow-auto bg-background p-4 text-foreground"
      aria-label="Sequence diagram visual editor"
    >
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
        <header>
          <h1 className="text-sm font-semibold">Sequence diagram</h1>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Use the drag handles with a pointer or press Space and the arrow
            keys. The move buttons provide the same reordering actions.
          </p>
        </header>

        <section aria-labelledby="sequence-participants-heading">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2
                id="sequence-participants-heading"
                className="text-xs font-semibold"
              >
                Sequence participants
              </h2>
              <p
                id="participant-delete-note"
                className="mt-1 text-[10px] text-muted-foreground"
              >
                Deleting a participant also deletes every message connected to
                it.
              </p>
            </div>
            <button
              type="button"
              className={primaryButtonClass}
              aria-expanded={showAddParticipant}
              onClick={() => setShowAddParticipant((visible) => !visible)}
            >
              Add participant
            </button>
          </div>

          {showAddParticipant && (
            <AddParticipantForm
              onCancel={() => setShowAddParticipant(false)}
              onAdd={(draft) => {
                const next = addSequenceParticipant(document.model, draft);
                commit(next);
                setShowAddParticipant(false);
                setStatus(`${draft.label} added.`);
              }}
            />
          )}

          {participants.length === 0 ? (
            <p className="mt-3 rounded-lg border border-dashed border-border p-5 text-center text-xs text-muted-foreground">
              Add a participant before creating messages.
            </p>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={participantDragEnd}
            >
              <SortableContext
                items={participants.map((participant) =>
                  participantDragId(participant.id),
                )}
                strategy={horizontalListSortingStrategy}
              >
                <ol
                  aria-label="Sequence participants in display order"
                  className="mt-3 flex list-none gap-2 overflow-x-auto pb-2"
                >
                  {participants.map((participant, index) => {
                    const relatedMessageCount = messages.filter(
                      (message) =>
                        message.from === participant.id ||
                        message.to === participant.id,
                    ).length;
                    return (
                      <ParticipantCard
                        key={participant.id}
                        participant={participant}
                        index={index}
                        total={participants.length}
                        relatedMessageCount={relatedMessageCount}
                        onMove={moveParticipant}
                        onSave={(participantId, draft) => {
                          commit(
                            updateSequenceParticipant(
                              document.model,
                              participantId,
                              draft,
                            ),
                          );
                          setStatus(`${draft.label} updated.`);
                        }}
                        onDelete={(participantId) => {
                          const relatedCount = messages.filter(
                            (message) =>
                              message.from === participantId ||
                              message.to === participantId,
                          ).length;
                          const participantLabel =
                            participants.find(
                              (item) => item.id === participantId,
                            )?.label ?? participantId;
                          commit(
                            deleteSequenceParticipant(
                              document.model,
                              participantId,
                            ),
                          );
                          setShowAddMessage(false);
                          setStatus(
                            `${participantLabel} deleted with ${plural(
                              relatedCount,
                              "related message",
                            )}.`,
                          );
                        }}
                      />
                    );
                  })}
                </ol>
              </SortableContext>
            </DndContext>
          )}
        </section>

        <section aria-labelledby="sequence-messages-heading">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2
                id="sequence-messages-heading"
                className="text-xs font-semibold"
              >
                Messages
              </h2>
              <p className="mt-1 text-[10px] text-muted-foreground">
                Messages run from top to bottom in this order.
              </p>
            </div>
            <button
              type="button"
              className={primaryButtonClass}
              aria-expanded={showAddMessage}
              disabled={participants.length === 0}
              title={
                participants.length === 0
                  ? "Add a participant before adding a message"
                  : undefined
              }
              onClick={() => setShowAddMessage((visible) => !visible)}
            >
              Add message
            </button>
          </div>

          {showAddMessage && participants.length > 0 && (
            <AddMessageForm
              participants={participants}
              onCancel={() => setShowAddMessage(false)}
              onAdd={(draft) => {
                commit(addSequenceMessage(document.model, draft));
                setShowAddMessage(false);
                setStatus(`${draft.text} added.`);
              }}
            />
          )}

          {messages.length === 0 ? (
            <p className="mt-3 rounded-lg border border-dashed border-border p-5 text-center text-xs text-muted-foreground">
              No messages yet.
            </p>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={messageDragEnd}
            >
              <SortableContext
                items={messages.map((message) => messageDragId(message.id))}
                strategy={verticalListSortingStrategy}
              >
                <ol
                  aria-label="Sequence messages in execution order"
                  className="mt-3 flex list-none flex-col gap-2"
                >
                  {messages.map((message, index) => (
                    <MessageCard
                      key={message.id}
                      message={message}
                      participants={participants}
                      index={index}
                      total={messages.length}
                      onMove={moveMessage}
                      onSave={(messageId, draft) => {
                        commit(
                          updateSequenceMessage(
                            document.model,
                            messageId,
                            draft,
                          ),
                        );
                        setStatus(`${draft.text} updated.`);
                      }}
                      onDelete={(messageId) => {
                        const messageText =
                          messages.find((item) => item.id === messageId)
                            ?.text ?? "Message";
                        commit(
                          deleteSequenceMessage(document.model, messageId),
                        );
                        setStatus(`${messageText} deleted.`);
                      }}
                    />
                  ))}
                </ol>
              </SortableContext>
            </DndContext>
          )}
        </section>
      </div>
      <p aria-live="polite" aria-atomic="true" className="sr-only">
        {status}
      </p>
    </section>
  );
}
