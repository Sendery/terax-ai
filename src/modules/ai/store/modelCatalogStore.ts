import { LazyStore } from "@tauri-apps/plugin-store";
import { create } from "zustand";
import { allocateSpawnId, killCliAgent, runCliAgent } from "../cli/bridge";
import { loadPiModels, usePiModelsStore } from "../cli/piModels";
import {
  parseVariantModelId,
  type ProviderId,
  rememberVariantLabel,
  variantModelId,
} from "../config";
import {
  CATALOG_SOURCES,
  CATALOG_TTL_MS,
  type CatalogModel,
  type CatalogView,
  parseApiModels,
  reconcileCatalog,
} from "../lib/modelCatalog";
import { proxyFetch } from "../lib/proxyFetch";
import { useChatStore } from "./chatStore";

export type CatalogEntry = {
  status: "loading" | "ready" | "error";
  /** True when the list came from the provider, not the built-in fallback. */
  live: boolean;
  fetchedAt: number;
  models: CatalogModel[];
  view: CatalogView;
  error?: string;
};

type State = { catalogs: Partial<Record<ProviderId, CatalogEntry>> };

export const useModelCatalogStore = create<State>(() => ({ catalogs: {} }));

const STORE_PATH = "terax-model-catalog.json";
const KEY = "catalogs";
const CLI_LIST_TIMEOUT_MS = 20_000;

type Persisted = Partial<
  Record<ProviderId, { fetchedAt: number; live: boolean; models: CatalogModel[] }>
>;

const store = new LazyStore(STORE_PATH, { defaults: {}, autoSave: 500 });
let hydrated: Promise<void> | null = null;
const inflight = new Map<ProviderId, Promise<void>>();

function entry(
  provider: ProviderId,
  models: CatalogModel[],
  live: boolean,
  fetchedAt: number,
): CatalogEntry {
  const view = reconcileCatalog(provider, models, live);
  for (const m of view.extra) rememberVariantLabel(m.id, m.label);
  return { status: "ready", live, fetchedAt, models, view };
}

function hydrate(): Promise<void> {
  hydrated ??= (async () => {
    const saved = ((await store.get<Persisted>(KEY).catch(() => null)) ?? {}) as Persisted;
    const catalogs: State["catalogs"] = {};
    for (const [provider, value] of Object.entries(saved) as [ProviderId, Persisted[ProviderId]][]) {
      if (!value || !Array.isArray(value.models) || !CATALOG_SOURCES[provider]) continue;
      // The file is ours but may be stale or edited: keep only rows that
      // still form a valid model id, so the picker never renders a bad one.
      const models = value.models.filter(
        (m): m is CatalogModel =>
          !!m &&
          typeof m.wire === "string" &&
          typeof m.label === "string" &&
          parseVariantModelId(variantModelId(provider, m.wire)) !== null,
      );
      catalogs[provider] = entry(provider, models, value.live === true, Number(value.fetchedAt) || 0);
    }
    useModelCatalogStore.setState((s) => ({ catalogs: { ...catalogs, ...s.catalogs } }));
  })();
  return hydrated;
}

function persist(): void {
  const out: Persisted = {};
  for (const [provider, value] of Object.entries(useModelCatalogStore.getState().catalogs) as [
    ProviderId,
    CatalogEntry | undefined,
  ][]) {
    if (value?.status === "ready") {
      out[provider] = { fetchedAt: value.fetchedAt, live: value.live, models: value.models };
    }
  }
  void store.set(KEY, out);
}

async function fetchApi(provider: ProviderId, url: string, auth: string): Promise<CatalogModel[] | null> {
  const key = useChatStore.getState().apiKeys[provider];
  if (auth !== "none" && !key) return null;
  const headers: Record<string, string> = {};
  if (auth === "bearer") headers.Authorization = `Bearer ${key}`;
  if (auth === "anthropic") {
    headers["x-api-key"] = key ?? "";
    headers["anthropic-version"] = "2023-06-01";
  }
  if (auth === "google") headers["x-goog-api-key"] = key ?? "";
  const res = await proxyFetch(url, { headers });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`.trim());
  return parseApiModels(provider, await res.json());
}

async function listCli(argv: string[]): Promise<string[]> {
  const id = allocateSpawnId();
  const lines: string[] = [];
  const timer = setTimeout(() => void killCliAgent(id), CLI_LIST_TIMEOUT_MS);
  try {
    await runCliAgent({ id, argv, cwd: null }, { onStdout: (line) => lines.push(line) });
  } finally {
    clearTimeout(timer);
  }
  return lines;
}

async function fetchCatalog(
  provider: ProviderId,
): Promise<{ models: CatalogModel[]; live: boolean; stale?: boolean }> {
  const source = CATALOG_SOURCES[provider];
  if (!source) return { models: [], live: false };
  switch (source.kind) {
    case "static":
      return { models: source.models, live: false };
    case "api": {
      const models = await fetchApi(provider, source.url, source.auth);
      // No key (a subscription sign-in, say): nothing to cache, so adding a
      // key later lists the catalogue on the next look instead of in 24 h.
      return models ? { models, live: true } : { models: [], live: false, stale: true };
    }
    case "cli":
      return { models: source.parse(await listCli(source.argv)), live: true };
    case "pi": {
      await loadPiModels(true);
      const models = usePiModelsStore
        .getState()
        .models.map((m) => ({ wire: `${m.provider}/${m.model}`, label: `${m.provider}/${m.model}` }));
      return { models, live: true };
    }
  }
}

/**
 * Make a provider's catalogue available, fetching it when missing, stale or
 * forced. Runs only when the picker shows the provider: nothing is fetched,
 * spawned or polled for a provider nobody looks at. A failure keeps the last
 * good list and records the error.
 */
export async function ensureCatalog(provider: ProviderId, force = false): Promise<void> {
  if (!CATALOG_SOURCES[provider]) return;
  await hydrate();
  const current = useModelCatalogStore.getState().catalogs[provider];
  const fresh = current?.status === "ready" && Date.now() - current.fetchedAt < CATALOG_TTL_MS;
  if (!force && fresh) return;
  const running = inflight.get(provider);
  if (running) return running;
  const set = (next: CatalogEntry) =>
    useModelCatalogStore.setState((s) => ({ catalogs: { ...s.catalogs, [provider]: next } }));
  if (current) set({ ...current, status: "loading" });
  const job = fetchCatalog(provider)
    .then(({ models, live, stale }) => {
      set(entry(provider, models, live, stale ? 0 : Date.now()));
      if (!stale) persist();
    })
    .catch((e: unknown) => {
      const message = e instanceof Error ? e.message : String(e);
      set(
        current
          ? { ...current, status: "error", error: message }
          : { ...entry(provider, [], false, 0), status: "error", error: message },
      );
    })
    .finally(() => inflight.delete(provider));
  inflight.set(provider, job);
  return job;
}
