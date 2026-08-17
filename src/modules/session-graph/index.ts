export {
  parseSessionLines,
  type ParsedSession,
  type SessionAgent,
  type SessionHeaderInfo,
  type SessionNode,
  type SessionNodeKind,
} from "./lib/entries";
export {
  buildSessionGraph,
  EMPTY_SESSION_GRAPH,
  type SessionBranch,
  type SessionGraph,
  type SessionGraphRow,
  type SessionMilestone,
} from "./lib/graph";
export {
  foldRows,
  nextMilestoneRow,
  previousMilestoneRow,
  railTicks,
  rowSummary,
} from "./lib/presentation";
export { agentKindFromName } from "./lib/agentKind";
export { pickSession, type SessionCandidate } from "./lib/pickSession";
export { useResolvedSession } from "./lib/useResolvedSession";
export { useSessionTranscript } from "./lib/useSessionTranscript";
export {
  GRAPH_MAX_WIDTH,
  GRAPH_MIN_WIDTH,
  useSessionGraphPanel,
} from "./lib/useSessionGraphPanel";
export { SessionGraphPanel } from "./SessionGraphPanel";
export {
  collapseByDensity,
  DENSITIES,
  type GraphDensity,
  type GraphEntry,
  nextDensity,
} from "./lib/density";
export {
  createMark,
  isSessionMark,
  MARK_COLORS,
  type MarkColor,
  parseStoredMarks,
  type SessionMark,
} from "./lib/marks";
export { useSessionMarks } from "./lib/useSessionMarks";
export { visibleWindow } from "./lib/virtual";
export {
  nodeGlyph,
  type NodeGlyph,
  type NodeTone,
  toneForToolName,
  TONE_COLOR,
  TONES,
} from "./lib/nodeGlyph";
export {
  type BranchChoice,
  type BranchFork,
  branchOptions,
  descendTip,
  sessionLineage,
  type SessionLink,
} from "./lib/branches";
export {
  type ActionId,
  availableActions,
  resumeCommand,
  type SessionAction,
} from "./lib/actions";
