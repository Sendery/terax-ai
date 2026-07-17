export {
  CI_STATES,
  JIRA_STATUS_CATEGORIES,
  PR_STATES,
  createCardFromInput,
  createCardFromUrl,
  createTextCard,
  detectProvider,
  isNoteCard,
  newNoteId,
  parseGithubPrUrl,
  parseJiraIssueKey,
} from "./lib/cards";
export { NotesPanel } from "./NotesPanel";
export { NotesDockedNotice } from "./NotesDockedNotice";
export { NoteCardView } from "./NoteCardView";
export { openNotesWindow, closeNotesWindow } from "./openNotesWindow";
export { useNotesWindowBridge } from "./lib/useNotesWindowBridge";
export {
  NOTES_WINDOW_LABEL,
  NOTES_SYNC_EVENT,
  NOTES_ACTION_EVENT,
  NOTES_READY_EVENT,
  NOTES_CLOSED_EVENT,
  isNotesSyncPayload,
  parseNotesAction,
  type NotesAction,
  type NotesSyncPayload,
} from "./lib/windowBridge";
export {
  NOTES_DEFAULT_WIDTH,
  NOTES_MAX_WIDTH,
  NOTES_MIN_WIDTH,
  useNotesPanel,
} from "./lib/useNotesPanel";
export {
  useTabNotes,
  type NotesMutator,
  type TabNotesApi,
} from "./lib/useTabNotes";
export {
  addCard,
  moveCard,
  removeCard,
  updateCard,
  type NoteCardPatch,
} from "./lib/collection";
export {
  cardAccessibleLabel,
  cardCitation,
  cardKindLabel,
  cardTitle,
} from "./lib/presentation";
export type {
  CiState,
  FigmaCard,
  GithubPrCard,
  GithubPrRef,
  JiraCard,
  JiraStatusCategory,
  LinkCard,
  LinkNoteCard,
  NoteCard,
  NoteCardKind,
  NoteProvider,
  NotionCard,
  ObsidianCard,
  PrState,
  TextCard,
} from "./lib/cards";
