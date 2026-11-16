import { beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  cursor: 0,
  slots: [] as { value: unknown; deps?: unknown[]; cleanup?: () => void }[],
  effects: [] as (() => void)[],
  paths: {} as Record<string, string | null>,
  refresh: vi.fn(),
  keysListener: null as (() => void) | null,
  select: vi.fn(),
  keys: {} as Record<string, string | null>,
  oauth: [] as { connected: boolean }[],
  prefs: {
    hydrated: true,
    defaultModelId: "cli-codex-agent",
    lmstudioBaseURL: "",
    lmstudioModelId: "",
    mlxBaseURL: "",
    mlxModelId: "",
    ollamaBaseURL: "",
    ollamaModelId: "",
    openaiCompatibleBaseURL: "",
    openaiCompatibleModelId: "",
    customEndpoints: [],
  },
  init: vi.fn(),
  hydrate: vi.fn(),
  setKeys: vi.fn(),
  setCustom: vi.fn(),
}));
vi.mock("react", () => ({
  useState(initial: unknown) {
    const i = h.cursor++;
    if (!h.slots[i]) h.slots[i] = { value: initial };
    const slot = h.slots[i];
    return [
      slot.value,
      (value: unknown) => {
        slot.value = value;
      },
    ];
  },
  useEffect(effect: () => undefined | (() => void), deps: unknown[]) {
    const i = h.cursor++;
    const prev = h.slots[i];
    if (prev && deps.every((d, j) => Object.is(d, prev.deps?.[j]))) return;
    const slot = { value: null, deps, cleanup: prev?.cleanup };
    h.slots[i] = slot;
    h.effects.push(() => {
      slot.cleanup?.();
      slot.cleanup = effect() || undefined;
    });
  },
}));
vi.mock("@/modules/agents/lib/review", () => ({
  firePendingReviewForSession: vi.fn(),
}));
vi.mock("@/modules/settings/preferences", () => ({
  usePreferencesStore: Object.assign(
    (select: (s: unknown) => unknown) => select({ ...h.prefs, init: h.init }),
    { getState: () => h.prefs },
  ),
}));
vi.mock("@/modules/settings/store", () => ({
  onKeysChanged: (cb: () => void) => {
    h.keysListener = cb;
    return Promise.resolve(() => {
      h.keysListener = null;
    });
  },
}));
vi.mock("@/modules/ai/lib/keyring", () => ({
  getAllKeys: () => Promise.resolve(h.keys),
  getAllCustomEndpointKeys: () => Promise.resolve({}),
  hasAnyKey: (keys: Record<string, string | null>) =>
    Object.values(keys).some(Boolean),
}));
vi.mock("@/modules/ai/lib/oauth", () => ({
  listOAuthAccounts: () => Promise.resolve(h.oauth),
}));
vi.mock("@/modules/ai/store/chatStore", () => ({
  useChatStore: (select: (s: unknown) => unknown) =>
    select({
      apiKeys: h.keys,
      setApiKeys: h.setKeys,
      setCustomEndpointKeys: h.setCustom,
      setSelectedModelId: h.select,
      activeSessionId: null,
      hydrateSessions: h.hydrate,
    }),
}));
vi.mock("@/modules/ai/store/agentsStore", () => ({
  useAgentsStore: { getState: () => ({ hydrate: h.hydrate }) },
}));
vi.mock("@/modules/ai/store/snippetsStore", () => ({
  useSnippetsStore: { getState: () => ({ hydrate: h.hydrate }) },
}));
vi.mock("@/modules/ai/cli/availability", () => ({
  useCliAvailabilityStore: (select: (s: unknown) => unknown) =>
    select({ paths: h.paths }),
  hasInstalledCli: (paths: Record<string, string | null>) =>
    Object.values(paths).some(Boolean),
  refreshCliAvailability: h.refresh,
}));
import { useAiBootstrap } from "./useAiBootstrap";
function TestHarness() {
  h.cursor = 0;
  const result = useAiBootstrap();
  while (h.effects.length) h.effects.shift()?.();
  return result;
}
beforeEach(() => {
  h.cursor = 0;
  h.slots = [];
  h.effects = [];
  h.paths = {};
  h.keys = {};
  h.oauth = [];
  h.prefs.hydrated = true;
  h.prefs.defaultModelId = "cli-codex-agent";
  h.prefs.ollamaBaseURL = "";
  h.prefs.ollamaModelId = "";
  h.refresh.mockReset();
  h.select.mockReset();
});
it("opens the composer and Ask Terax gate for an installed CLI without SDK credentials", () => {
  expect(TestHarness().hasComposer).toBe(false);
  h.paths = { codex: "/fixture/codex" };
  expect(TestHarness().hasComposer).toBe(true);
  expect(h.select).toHaveBeenCalledExactlyOnceWith("cli-codex-agent");
  expect(h.refresh).toHaveBeenCalledTimes(2);
});
it("keeps keyless-only access closed when detection has no installed CLI", () => {
  h.paths = { codex: null, claude: null };
  expect(TestHarness().hasComposer).toBe(false);
  expect(h.select).toHaveBeenCalledWith("cli-codex-agent");
});
it("waits for preference hydration and refreshes a changed default without changing it", () => {
  h.prefs.hydrated = false;
  TestHarness();
  expect(h.refresh).not.toHaveBeenCalled();
  expect(h.select).not.toHaveBeenCalled();
  h.prefs.hydrated = true;
  TestHarness();
  expect(h.select).toHaveBeenLastCalledWith("cli-codex-agent");
  h.paths = { claude: "/fixture/claude" };
  TestHarness();
  expect(h.select).toHaveBeenCalledTimes(1);
  h.prefs.defaultModelId = "cli-claude-agent";
  TestHarness();
  expect(h.select).toHaveBeenLastCalledWith("cli-claude-agent");
  expect(h.refresh).toHaveBeenCalledTimes(3);
});
it("preserves API key, local endpoint and connected subscription access", async () => {
  h.keys = { openai: "public-test-key" };
  expect(TestHarness().hasComposer).toBe(true);
  h.keys = {};
  h.prefs.ollamaBaseURL = "http://localhost:11434";
  h.prefs.ollamaModelId = "fixture";
  expect(TestHarness().hasComposer).toBe(true);
  h.prefs.ollamaBaseURL = "";
  h.prefs.ollamaModelId = "";
  h.slots = [];
  h.oauth = [{ connected: true }];
  TestHarness();
  await Promise.resolve();
  expect(TestHarness().hasComposer).toBe(true);
});

it("refreshes provider invalidation without overriding a manually selected model", () => {
  TestHarness();
  h.select.mockClear();
  h.refresh.mockClear();
  h.keysListener?.();
  expect(h.refresh).toHaveBeenCalledWith({ invalidate: true });
  expect(h.select).not.toHaveBeenCalled();
});
