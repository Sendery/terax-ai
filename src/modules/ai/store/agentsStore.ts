import { emit, listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import {
  BUILTIN_AGENTS,
  loadAgents,
  newAgentId,
  saveActiveAgentId,
  saveCustomAgents,
  saveModelDefaults,
  type Agent,
  type AgentModelDefault,
  type AgentModelDefaults,
} from "../lib/agents";

const CHANGED_EVENT = "terax://ai-agents-changed";

type AgentsState = {
  hydrated: boolean;
  customAgents: Agent[];
  activeId: string;
  /** Model each agent starts with, keyed by agent id. Built-ins included. */
  modelDefaults: AgentModelDefaults;
  /** All agents, builtin first. */
  all: () => Agent[];
  hydrate: () => Promise<void>;
  setActiveId: (id: string) => void;
  upsert: (agent: Agent) => void;
  remove: (id: string) => void;
  setModelDefault: (id: string, value: AgentModelDefault | null) => void;
};

let initialized = false;

function broadcast(): void {
  void emit(CHANGED_EVENT);
}

export const useAgentsStore = create<AgentsState>((set, get) => ({
  hydrated: false,
  customAgents: [],
  activeId: BUILTIN_AGENTS[0].id,
  modelDefaults: {},
  all: () => [...BUILTIN_AGENTS, ...get().customAgents],
  hydrate: async () => {
    if (initialized) return;
    initialized = true;
    const { custom, activeId, modelDefaults } = await loadAgents();
    set({ customAgents: custom, activeId, modelDefaults, hydrated: true });

    void listen(CHANGED_EVENT, async () => {
      const fresh = await loadAgents();
      set({
        customAgents: fresh.custom,
        activeId: fresh.activeId,
        modelDefaults: fresh.modelDefaults,
      });
    });
  },
  setActiveId: (id) => {
    set({ activeId: id });
    void saveActiveAgentId(id).then(broadcast);
  },
  upsert: (agent) => {
    if (agent.builtIn) return;
    const list = get().customAgents;
    const idx = list.findIndex((a) => a.id === agent.id);
    const next =
      idx === -1 ? [...list, agent] : list.map((a) => (a.id === agent.id ? agent : a));
    set({ customAgents: next });
    void saveCustomAgents(next).then(broadcast);
  },
  remove: (id) => {
    const list = get().customAgents.filter((a) => a.id !== id);
    set({ customAgents: list });
    let active = get().activeId;
    if (active === id) {
      active = BUILTIN_AGENTS[0].id;
      set({ activeId: active });
      void saveActiveAgentId(active);
    }
    if (get().modelDefaults[id]) get().setModelDefault(id, null);
    void saveCustomAgents(list).then(broadcast);
  },
  setModelDefault: (id, value) => {
    const next = { ...get().modelDefaults };
    if (value) next[id] = value;
    else delete next[id];
    set({ modelDefaults: next });
    void saveModelDefaults(next).then(broadcast);
  },
}));

export { newAgentId };
