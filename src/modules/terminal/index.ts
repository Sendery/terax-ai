export { TerminalPane, type TerminalPaneHandle } from "./TerminalPane";
export { TerminalStack } from "./TerminalStack";
export {
  captureLeafInput,
  captureLeafSubmission,
  canClearActiveLeaf,
  canClearFocusedTerminal,
  clearActiveLeaf,
  clearFocusedTerminal,
  disposeSession,
  isLeafTuiReady,
  leafHasForegroundProcess,
  leafIdForPty,
  navigateFocusedBlocks,
  ptyIdForLeaf,
  repaintLeaf,
  respawnSession,
  submitToLeaf,
  whenSessionReady,
  writeToSession,
} from "./lib/leafSession";
export {
  aggregateAgentPhases,
  type AgentTabStatus,
  type AttentionCause,
  useAgentActivityStore,
} from "./lib/agentActivity";
export { useTerminalFileDrop } from "./lib/useTerminalFileDrop";
export {
  findLeafCwd,
  hasLeaf,
  isLeaf,
  leafIds,
  type PaneId,
  type PaneNode,
  type SplitDir,
} from "./lib/panes";
