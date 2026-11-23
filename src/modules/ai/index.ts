export {
  AgentRunBridge,
  AiChatBottomPane,
  AiChatDock,
  AiInputBarConnect,
  AiMiniWindow,
} from "./components/lazy";
export { useChatLayoutStore } from "./store/chatLayoutStore";
export { AgentStatusPill } from "./components/AgentStatusPill";
export { useAiBootstrap } from "./hooks/useAiBootstrap";
export { useAiLiveBridge } from "./lib/useAiLiveBridge";
export { LocalAgentNotificationsBridge } from "./components/LocalAgentNotificationsBridge";
export {
  EMPTY_PROVIDER_KEYS,
  getAllKeys,
  getAllCustomEndpointKeys,
  getKey,
  setKey,
  clearKey,
  hasAnyKey,
  type ProviderKeys,
  type CustomEndpointKeys,
} from "./lib/keyring";
export {
  getActiveProviderKey,
  hasKeyForModel,
  stop,
  useChatStore,
  type AgentMeta,
  type AgentRunStatus,
} from "./store/chatStore";
// Heavy chat runtime (@ai-sdk/react + ai SDK) is intentionally NOT re-exported
// here: this barrel is eagerly imported by App, and a static re-export would
// pull the whole SDK into the startup graph. Import from ./store/chatRuntime.
