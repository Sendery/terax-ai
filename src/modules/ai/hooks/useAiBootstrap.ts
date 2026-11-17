import {
  hasInstalledCli,
  refreshCliAvailability,
  useCliAvailabilityStore,
} from "@/modules/ai/cli/availability";
import { useEffect, useState } from "react";
import { firePendingReviewForSession } from "@/modules/agents/lib/review";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { onKeysChanged, setPiModel } from "@/modules/settings/store";
import { isCompatModelId, isKnownModelId } from "../config";
import { isPiModelPattern } from "../cli/pi";
import { resolveAgentModel } from "../lib/agents";
import {
  getAllCustomEndpointKeys,
  getAllKeys,
  hasAnyKey,
} from "../lib/keyring";
import { listOAuthAccounts, type OAuthAccount } from "../lib/oauth";
import { useAgentsStore } from "../store/agentsStore";
import { useChatStore } from "../store/chatStore";
import { useSnippetsStore } from "../store/snippetsStore";

const PI_CHAT_MODEL_ID = "cli-pi-agent";

/**
 * Startup wiring for the AI subsystem: loads provider keys (and keeps them in
 * sync), hydrates the preference store and mirrors the default model, hydrates
 * chat/agents/snippets stores, and fires any pending review for the active
 * session. Returns the two derived flags the shell needs.
 */
export function useAiBootstrap(): {
  hasComposer: boolean;
  keysLoaded: boolean;
} {
  const apiKeys = useChatStore((s) => s.apiKeys);
  const setApiKeys = useChatStore((s) => s.setApiKeys);
  const setCustomEndpointKeys = useChatStore((s) => s.setCustomEndpointKeys);
  const setSelectedModelId = useChatStore((s) => s.setSelectedModelId);
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const hydrateSessions = useChatStore((s) => s.hydrateSessions);

  useEffect(() => {
    if (activeSessionId) firePendingReviewForSession(activeSessionId);
  }, [activeSessionId]);

  const lmstudioModelId = usePreferencesStore((s) => s.lmstudioModelId);
  const lmstudioBaseURL = usePreferencesStore((s) => s.lmstudioBaseURL);
  const mlxModelId = usePreferencesStore((s) => s.mlxModelId);
  const mlxBaseURL = usePreferencesStore((s) => s.mlxBaseURL);
  const ollamaModelId = usePreferencesStore((s) => s.ollamaModelId);
  const ollamaBaseURL = usePreferencesStore((s) => s.ollamaBaseURL);
  const openaiCompatibleModelId = usePreferencesStore(
    (s) => s.openaiCompatibleModelId,
  );
  const openaiCompatibleBaseURL = usePreferencesStore(
    (s) => s.openaiCompatibleBaseURL,
  );
  const customEndpoints = usePreferencesStore((s) => s.customEndpoints);
  const hasLocalModel =
    (lmstudioBaseURL.trim().length > 0 && lmstudioModelId.trim().length > 0) ||
    (mlxBaseURL.trim().length > 0 && mlxModelId.trim().length > 0) ||
    (ollamaBaseURL.trim().length > 0 && ollamaModelId.trim().length > 0) ||
    (openaiCompatibleBaseURL.trim().length > 0 &&
      openaiCompatibleModelId.trim().length > 0) ||
    customEndpoints.some(
      (e) => e.baseURL.trim().length > 0 && e.modelId.trim().length > 0,
    );
  // A connected subscription is a credential like any other, so it opens the
  // composer on its own.
  const [oauthAccounts, setOauthAccounts] = useState<OAuthAccount[]>([]);
  const hasOAuthAccount = oauthAccounts.some((a) => a.connected);
  const cliPaths = useCliAvailabilityStore((s) => s.paths);
  const hasComposer =
    hasAnyKey(apiKeys) || hasLocalModel || hasOAuthAccount || hasInstalledCli(cliPaths);

  const prefsHydrated = usePreferencesStore((s) => s.hydrated);
  const [keysLoaded, setKeysLoaded] = useState(false);
  useEffect(() => {
    let alive = true;
    const reload = () => {
      void getAllKeys().then((keys) => {
        if (!alive) return;
        setApiKeys(keys);
        setKeysLoaded(true);
      });
      void listOAuthAccounts().then((accounts) => {
        if (!alive) return;
        setOauthAccounts(accounts);
      });
      if (!prefsHydrated) return;
      void refreshCliAvailability();
      void getAllCustomEndpointKeys(
        usePreferencesStore.getState().customEndpoints,
      ).then((epKeys) => {
        if (!alive) return;
        setCustomEndpointKeys(epKeys);
      });
    };
    reload();
    const unlistenP = onKeysChanged(() => {
      if (prefsHydrated) void refreshCliAvailability({invalidate: true});
      reload();
    });
    return () => {
      alive = false;
      void unlistenP.then((fn) => fn());
    };
  }, [setApiKeys, setCustomEndpointKeys, prefsHydrated]);

  // Hydrate the cross-window preference store and mirror the default model
  // into chatStore so the dropdown reflects what the user picked in Settings.
  const initPrefs = usePreferencesStore((s) => s.init);
  const prefDefaultModel = usePreferencesStore((s) => s.defaultModelId);
  useEffect(() => {
    void initPrefs();
  }, [initPrefs]);
  useEffect(() => {
    if (!prefsHydrated) return;
    setSelectedModelId(prefDefaultModel);
    void refreshCliAvailability();
  }, [prefsHydrated, prefDefaultModel, setSelectedModelId]);

  // An agent's default model wins over the global one whenever that agent
  // becomes active (at startup too). It only sets the starting point: the
  // picker still changes the model for as long as the agent stays selected.
  const activeAgentId = useAgentsStore((s) => s.activeId);
  const agentDefaults = useAgentsStore((s) => s.modelDefaults);
  const agentDefault = resolveAgentModel(
    agentDefaults,
    activeAgentId,
    (id) => isKnownModelId(id) || isCompatModelId(id),
  );
  const agentModelId = agentDefault?.modelId;
  const agentPiModel = agentDefault?.piModel;
  // biome-ignore lint/correctness/useExhaustiveDependencies: prefDefaultModel re-applies the agent's model after the global default resets the selection.
  useEffect(() => {
    if (!prefsHydrated || !agentModelId) return;
    setSelectedModelId(agentModelId);
    if (
      agentModelId === PI_CHAT_MODEL_ID &&
      agentPiModel !== undefined &&
      (agentPiModel === "" || isPiModelPattern(agentPiModel))
    ) {
      void setPiModel(agentPiModel);
    }
  }, [
    prefsHydrated,
    prefDefaultModel,
    activeAgentId,
    agentModelId,
    agentPiModel,
    setSelectedModelId,
  ]);

  useEffect(() => {
    void hydrateSessions();
    void useAgentsStore.getState().hydrate();
    void useSnippetsStore.getState().hydrate();
  }, [hydrateSessions]);

  return { hasComposer, keysLoaded };
}
