import {
  providerAvailableInPicker,
  refreshCliAvailability,
  useCliAvailabilityStore,
} from "@/modules/ai/cli/availability";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import { fmtShortcut, MOD_KEY } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { openSettingsWindow } from "@/modules/settings/openSettingsWindow";
import {
  Add01Icon,
  AiBookIcon,
  ArrowDown01Icon,
  BrainIcon,
  Clock01Icon,
  CoinsDollarIcon,
  FavouriteIcon,
  FlashIcon,
  Message01Icon,
  Mic01Icon,
  PlugIcon,
  RefreshIcon,
  Search01Icon,
  Settings01Icon,
  StarIcon,
  Tick01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  compatModelIdForEndpoint,
  getCompatModelInfo,
  getModel,
  isCompatModelId,
  MODELS,
  isCliProvider,
  parseVariantModelId,
  PROVIDERS,
  STT_PROVIDER_LABELS,
  type ModelCapabilities,
  type ModelInfo,
  type ProviderId,
} from "../config";
import { ACCEPTED_FILES, useComposer } from "../lib/composer";
import { toggleFavoriteModel } from "../lib/modelPrefs";
import { useChatStore } from "../store/chatStore";
import type { CatalogEntry } from "../store/modelCatalogStore";
import { PI_MODEL_ID, usePiModelLabel } from "./PiModelSection";
import {
  groupProviders,
  ORIGIN_META,
  PROVIDER_ICONS,
  PROVIDER_ORIGINS,
  providerTitle,
} from "../lib/providerPresentation";
import { CATALOG_SOURCES } from "../lib/modelCatalog";
import { ensureCatalog, useModelCatalogStore } from "../store/modelCatalogStore";
import { relativeCommitTime } from "@/modules/git-history/lib/relativeTime";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { setPiModel } from "@/modules/settings/store";

const PROVIDER_ICON = PROVIDER_ICONS;

/**
 * Opens the AI panel, and closes it again. It stays on screen while the panel
 * is open without a provider configured, and that state has no other exit.
 */
export function AiOpenButton({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "flex h-6 min-w-0 items-center gap-1.5 rounded-md border border-border/60 bg-card px-2 text-xs",
        "text-muted-foreground transition-colors hover:border-border hover:bg-accent hover:text-foreground",
        "animate-in slide-in-from-top-2 duration-200 ease-out",
      )}
      title={open ? "Close AI panel" : "Open AI agent"}
    >
      <span className="min-w-0 truncate">
        {open ? "Close AI panel" : "Open AI agent"}
      </span>
      <Kbd className="h-4 min-w-4 shrink-0 px-1">
        {fmtShortcut(MOD_KEY, "I")}
      </Kbd>
    </button>
  );
}

export function AiStatusBarControls() {
  const c = useComposer();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const toggleMini = useChatStore((s) => s.toggleMini);
  const miniOpen = useChatStore((s) => s.mini.open);
  const closePanel = useChatStore((s) => s.closePanel);

  return (
    <div className="flex min-w-0 items-center gap-0.5">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={ACCEPTED_FILES}
        className="hidden"
        onChange={(e) => {
          void c.addFiles(e.target.files);
          e.target.value = "";
        }}
      />

      <IconBtn
        title="Attach file or image"
        onClick={() => fileInputRef.current?.click()}
        disabled={c.isBusy}
      >
        <HugeiconsIcon icon={Add01Icon} size={13} strokeWidth={2} />
      </IconBtn>

      {c.voice.supported && (
        <IconBtn
          title={
            !c.voice.hasKey
              ? `Voice needs a ${STT_PROVIDER_LABELS[c.voice.sttProvider]} key`
              : c.voice.unavailableReason && !c.voice.recording
                ? c.voice.unavailableReason
                : c.voice.recording
                ? "Stop & transcribe"
                : c.voice.transcribing
                  ? "Transcribing…"
                  : "Voice input"
          }
          onClick={() =>
            c.voice.recording ? c.voice.stop() : void c.voice.start()
          }
          disabled={c.isBusy || c.voice.transcribing || !c.voice.hasKey}
          className={cn(
            c.voice.recording &&
            "bg-destructive/10 text-destructive hover:bg-destructive/15",
          )}
        >
          {c.voice.recording ? (
            <span className="size-2 animate-pulse rounded-full bg-destructive" />
          ) : c.voice.transcribing ? (
            <Spinner className="size-3" />
          ) : (
            <HugeiconsIcon icon={Mic01Icon} size={13} strokeWidth={1.75} />
          )}
        </IconBtn>
      )}

      <ModelDropdown />

      <span className="mx-1 h-8 w-px shrink-0 bg-border" aria-hidden />
      <IconBtn
        title={`${miniOpen ? "Close" : "Open"} AI chat window (${fmtShortcut("⇧", MOD_KEY, "I")})`}
        onClick={toggleMini}
      >
        <HugeiconsIcon icon={Message01Icon} size={13} strokeWidth={1.75} />
      </IconBtn>
      <IconBtn
        title={`Collapse AI panel (${fmtShortcut(MOD_KEY, "I")})`}
        onClick={closePanel}
      >
        <HugeiconsIcon icon={ArrowDown01Icon} size={14} strokeWidth={2} />
      </IconBtn>
    </div>
  );
}

type Tab = "all" | "favorites" | "recent";

function ModelDropdown() {
  const selected = useChatStore((s) => s.selectedModelId);
  const cliPaths = useCliAvailabilityStore((s) => s.paths);
  const apiKeys = useChatStore((s) => s.apiKeys);
  const setSelected = useChatStore((s) => s.setSelectedModelId);
  const favoriteIds = usePreferencesStore((s) => s.favoriteModelIds);
  const recentIds = usePreferencesStore((s) => s.recentModelIds);
  const customEndpoints = usePreferencesStore((s) => s.customEndpoints);
  const current = isCompatModelId(selected)
    ? getCompatModelInfo(selected, customEndpoints)
    : getModel(selected);
  const piLabel = usePiModelLabel();
  const triggerLabel =
    selected === PI_MODEL_ID ? `${current.label} · ${piLabel}` : current.label;
  const [search, setSearch] = useState("");
  const [activeProvider, setActiveProvider] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("all");
  const inputRef = useRef<HTMLInputElement>(null);
  const hasKeyFor = useCallback(
    (id: ProviderId) => providerAvailableInPicker(id, apiKeys, cliPaths),
    [apiKeys, cliPaths],
  );
  const currentProviderHasKey =
    isCompatModelId(selected) || hasKeyFor(current.provider);

  const epModelInfos = useMemo(() => {
    return customEndpoints.map((ep) =>
      getCompatModelInfo(compatModelIdForEndpoint(ep.id), customEndpoints),
    );
  }, [customEndpoints]);

  const providerGroups = useMemo(
    () =>
      groupProviders(
        PROVIDERS.filter((p) => p.id !== "openai-compatible"),
        hasKeyFor,
      ),
    [hasKeyFor],
  );

  const catalogs = useModelCatalogStore((s) => s.catalogs);
  const [open, setOpen] = useState(false);

  // Catalogues load only for the provider on screen, and for the providers a
  // starred or recent catalogue model belongs to, so their labels resolve.
  useEffect(() => {
    if (!open) return;
    const wanted = new Set<ProviderId>();
    if (activeProvider && activeProvider in CATALOG_SOURCES && hasKeyFor(activeProvider as ProviderId)) {
      wanted.add(activeProvider as ProviderId);
    }
    for (const id of [...favoriteIds, ...recentIds, selected]) {
      const variant = parseVariantModelId(id);
      if (variant && hasKeyFor(variant.provider)) wanted.add(variant.provider);
    }
    for (const provider of wanted) void ensureCatalog(provider);
  }, [open, activeProvider, favoriteIds, recentIds, selected, hasKeyFor]);

  const catalogModels = useMemo(() => {
    const out: ModelInfo[] = [];
    for (const value of Object.values(catalogs)) {
      for (const m of value?.view.extra ?? []) out.push(getModel(m.id));
    }
    return out;
  }, [catalogs]);

  // Starred or recent catalogue models whose catalogue has not loaded yet
  // still resolve (the id carries the provider and model name).
  const knownVariantIds = useMemo(() => {
    const known = new Set(catalogModels.map((m) => m.id));
    return [...favoriteIds, ...recentIds].filter(
      (id) => !known.has(id) && parseVariantModelId(id) !== null,
    );
  }, [catalogModels, favoriteIds, recentIds]);

  const allModels = useMemo(
    () => [
      ...MODELS,
      ...epModelInfos,
      ...catalogModels,
      ...[...new Set(knownVariantIds)].map((id) => getModel(id)),
    ],
    [epModelInfos, catalogModels, knownVariantIds],
  );

  const unlisted = useMemo(() => {
    const out = new Set<string>();
    for (const value of Object.values(catalogs)) {
      for (const id of value?.view.unlisted ?? []) out.add(id);
    }
    return out;
  }, [catalogs]);

  const COMPAT_PROVIDER_ID = "__compat__";

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let pool: readonly ModelInfo[] = allModels;
    if (tab === "favorites") {
      pool = pool.filter((m) => favoriteIds.includes(m.id));
    } else if (tab === "recent") {
      const order = new Map(recentIds.map((id, i) => [id, i]));
      pool = pool
        .filter((m) => order.has(m.id))
        .slice()
        .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    }
    if (activeProvider === COMPAT_PROVIDER_ID) {
      pool = pool.filter((m) => isCompatModelId(m.id));
    } else if (activeProvider !== null) {
      pool = pool.filter((m) => m.provider === activeProvider);
    } else if (tab === "all" && !q) {
      // The unfiltered list stays the curated one; catalogues can hold
      // hundreds of models and are browsed per provider or by search.
      pool = pool.filter((m) => !parseVariantModelId(m.id));
    }
    if (q) {
      pool = pool.filter(
        (m) =>
          m.label.toLowerCase().includes(q) ||
          m.hint.toLowerCase().includes(q) ||
          m.description.toLowerCase().includes(q) ||
          m.provider.includes(q) ||
          (m.tags?.some((t) => t.includes(q)) ?? false),
      );
    }
    return pool;
  }, [activeProvider, allModels, favoriteIds, recentIds, search, tab]);

  return (
    <DropdownMenu
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void refreshCliAvailability();
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(
            "h-5.5 min-w-0 gap-1 rounded-md px-1.5 my-1 text-xs hover:bg-accent hover:text-foreground",
            currentProviderHasKey
              ? "text-muted-foreground"
              : "text-amber-600 dark:text-amber-400",
          )}
          title={
            currentProviderHasKey
              ? `Model: ${triggerLabel}`
              : isCliProvider(current.provider)
                ? `${current.label}: CLI unavailable`
                : `${current.label}: no key configured`
          }
        >
          <span className="min-w-0 truncate">{triggerLabel}</span>
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            size={11}
            strokeWidth={2}
            className="shrink-0 opacity-70"
          />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        className="w-[28rem] p-0 overflow-hidden rounded-xl border border-border/70 shadow-xl"
        onFocusCapture={(e) => {
          if (e.target !== inputRef.current) inputRef.current?.focus();
        }}
      >
        {/* Search */}
        <div className="flex items-center gap-2.5 border-b border-border/70 px-3 py-2.5">
          <HugeiconsIcon
            icon={Search01Icon}
            size={16}
            strokeWidth={1.75}
            className="shrink-0 text-muted-foreground/70"
          />
          <input
            ref={inputRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            placeholder="Search models, providers, capabilities…"
            className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground/60"
          />
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-0.5 border-b border-border/70 px-2 py-1.5">
          <TabButton
            label="All"
            icon={AiBookIcon}
            active={tab === "all"}
            onClick={() => setTab("all")}
          />
          <TabButton
            label="Favorites"
            icon={FavouriteIcon}
            active={tab === "favorites"}
            onClick={() => setTab("favorites")}
            count={favoriteIds.length || undefined}
          />
          <TabButton
            label="Recent"
            icon={Clock01Icon}
            active={tab === "recent"}
            onClick={() => setTab("recent")}
            count={recentIds.length || undefined}
          />
        </div>

        <div className="flex max-h-104 min-h-0">
          {/* Provider sidebar — configured first, unconfigured muted, no dividers. */}
          <div className="flex w-11 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border/70 bg-muted/20 py-1.5">
            <ProviderPill
              icon={AiBookIcon}
              title="All providers"
              active={activeProvider === null}
              onClick={() => setActiveProvider(null)}
            />
            {providerGroups.map((group) => (
              <div key={group.origin} className="flex flex-col gap-0.5">
                <div
                  className="mx-auto mt-1 h-px w-5 bg-border/70"
                  title={ORIGIN_META[group.origin].title}
                />
                {group.providers.map((p) => (
                  <ProviderPill
                    key={p.id}
                    icon={PROVIDER_ICON[p.id]}
                    badge={ORIGIN_META[PROVIDER_ORIGINS[p.id]].badge}
                    title={
                      hasKeyFor(p.id)
                        ? providerTitle(p.id)
                        : `${providerTitle(p.id)}: not configured`
                    }
                    active={activeProvider === p.id}
                    muted={!hasKeyFor(p.id)}
                    onClick={() => setActiveProvider(p.id)}
                  />
                ))}
              </div>
            ))}
            {customEndpoints.length > 0 && (
              <ProviderPill
                icon={PlugIcon}
                title="OpenAI Compatible"
                active={activeProvider === COMPAT_PROVIDER_ID}
                onClick={() => setActiveProvider(COMPAT_PROVIDER_ID)}
              />
            )}
          </div>

          {/* Models list */}
          <div className="min-h-0 flex-1 overflow-y-auto py-1">
            {activeProvider === COMPAT_PROVIDER_ID && (
              <div className="flex items-center gap-1.5 px-3 pt-1 pb-1.5 text-[11px] font-medium tracking-tight text-muted-foreground/90">
                <HugeiconsIcon icon={PlugIcon} size={13} strokeWidth={1.75} />
                <span>OpenAI Compatible</span>
              </div>
            )}
            {activeProvider !== null &&
            activeProvider !== COMPAT_PROVIDER_ID ? (
              <ProviderHeader
                providerId={activeProvider as ProviderId}
                catalog={catalogs[activeProvider as ProviderId]}
                canRefresh={
                  activeProvider in CATALOG_SOURCES &&
                  hasKeyFor(activeProvider as ProviderId)
                }
              />
            ) : null}
            {activeProvider !== null &&
            activeProvider !== COMPAT_PROVIDER_ID &&
            !hasKeyFor(activeProvider as ProviderId) ? (
              <ProviderConfigureCTA providerId={activeProvider as ProviderId} />
            ) : null}
            {filtered.length === 0 ? (
              <div className="flex items-center justify-center px-4 py-10 text-xs text-muted-foreground/70">
                {tab === "favorites"
                  ? "No favorites yet — star a model to pin it here."
                  : tab === "recent"
                    ? "No recently-used models."
                    : "No models match."}
              </div>
            ) : (
              filtered.map((m) => (
                <ModelRow
                  key={m.id}
                  model={m}
                  selected={m.id === selected}
                  hasKey={
                    isCompatModelId(m.id) ||
                    hasKeyFor(m.provider)
                  }
                  favorite={favoriteIds.includes(m.id)}
                  showProviderIcon={activeProvider === null}
                  badge={
                    unlisted.has(m.id)
                      ? "unlisted"
                      : parseVariantModelId(m.id) && !isCliProvider(m.provider)
                        ? "new"
                        : null
                  }
                  onPick={() => {
                    if (!isCompatModelId(m.id) && !hasKeyFor(m.provider)) {
                      void openSettingsWindow("models");
                      return;
                    }
                    // The bare Pi row means Pi's own default; a Pi model
                    // picked earlier now has its own catalogue row.
                    if (m.id === PI_MODEL_ID) void setPiModel("");
                    setSelected(m.id);
                  }}
                  onToggleFavorite={() => void toggleFavoriteModel(m.id)}
                />
              ))
            )}
          </div>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TabButton({
  label,
  icon,
  active,
  count,
  onClick,
}: {
  label: string;
  icon: typeof AiBookIcon;
  active: boolean;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] transition-colors",
        active
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
      )}
    >
      <HugeiconsIcon icon={icon} size={12} strokeWidth={1.75} />
      {label}
      {count != null ? (
        <span className="rounded-full bg-muted/60 px-1.5 text-[9.5px] tabular-nums text-muted-foreground">
          {count}
        </span>
      ) : null}
    </button>
  );
}

function ProviderPill({
  icon,
  badge,
  title,
  active,
  muted,
  onClick,
}: {
  icon: typeof AiBookIcon;
  /** Origin mark drawn in the corner: API key, plan, CLI or local. */
  badge?: typeof AiBookIcon;
  title: string;
  active: boolean;
  muted?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        "relative mx-auto flex size-8 items-center justify-center rounded-md transition-colors",
        active
          ? "bg-accent text-foreground after:absolute after:right-0 after:top-1.5 after:bottom-1.5 after:w-[2px] after:rounded-full after:bg-primary after:content-['']"
          : muted
            ? "text-muted-foreground/50 hover:bg-accent/40 hover:text-foreground"
            : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
      )}
    >
      <HugeiconsIcon icon={icon} size={16} strokeWidth={1.5} />
      {badge ? (
        <span className="absolute right-0.5 bottom-0.5 flex size-3 items-center justify-center rounded-sm bg-background/90 ring-1 ring-border/70">
          <HugeiconsIcon icon={badge} size={8} strokeWidth={2} />
        </span>
      ) : null}
    </button>
  );
}

function catalogNote(catalog: CatalogEntry | undefined): string | null {
  if (!catalog) return null;
  if (catalog.status === "loading") return "Updating models";
  if (catalog.status === "error") return `Could not list models: ${catalog.error ?? "error"}`;
  if (!catalog.live) return "Built-in list";
  const age = relativeCommitTime(Math.floor(catalog.fetchedAt / 1000), Math.floor(Date.now() / 1000));
  return `Listed by the provider ${age === "now" ? "just now" : `${age} ago`}`;
}

function ProviderHeader({
  providerId,
  catalog,
  canRefresh,
}: {
  providerId: ProviderId;
  catalog: CatalogEntry | undefined;
  canRefresh: boolean;
}) {
  const p = PROVIDERS.find((x) => x.id === providerId);
  if (!p) return null;
  const origin = ORIGIN_META[PROVIDER_ORIGINS[p.id]];
  const note = catalogNote(catalog);
  return (
    <div className="flex items-center gap-1.5 px-3 pt-1 pb-1.5 text-[11px] font-medium tracking-tight text-muted-foreground/90">
      <HugeiconsIcon
        icon={PROVIDER_ICON[p.id]}
        size={13}
        strokeWidth={1.75}
      />
      <span>{providerTitle(p.id)}</span>
      <span title={origin.title} className="text-muted-foreground/60">
        <HugeiconsIcon icon={origin.badge} size={10} strokeWidth={2} />
      </span>
      {note ? (
        <span
          title={note}
          className={cn(
            "ml-auto min-w-0 truncate font-normal",
            catalog?.status === "error" ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground/60",
          )}
        >
          {note}
        </span>
      ) : null}
      {canRefresh ? (
        <button
          type="button"
          title="Refresh the model list"
          aria-label="Refresh the model list"
          disabled={catalog?.status === "loading"}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void ensureCatalog(providerId, true);
          }}
          className={cn(
            "shrink-0 rounded p-0.5 text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40",
            !note && "ml-auto",
          )}
        >
          {catalog?.status === "loading" ? (
            <Spinner className="size-3" />
          ) : (
            <HugeiconsIcon icon={RefreshIcon} size={11} strokeWidth={2} />
          )}
        </button>
      ) : null}
    </div>
  );
}

function ProviderConfigureCTA({ providerId }: { providerId: ProviderId }) {
  const p = PROVIDERS.find((x) => x.id === providerId);
  if (!p) return null;
  return (
    <button
      type="button"
      onClick={() => void openSettingsWindow("models")}
      className="group mx-2 mb-1 flex w-[calc(100%-1rem)] items-center gap-2 rounded-md border border-dashed border-border/70 bg-muted/20 px-3 py-2 text-left text-[11px] text-muted-foreground transition-colors hover:border-border hover:bg-accent/40 hover:text-foreground"
    >
      <HugeiconsIcon icon={Settings01Icon} size={13} strokeWidth={1.75} />
      <span className="flex-1 truncate">
        Configure {p.label} to use these models.
      </span>
      <span className="shrink-0 text-[10px] underline-offset-2 group-hover:underline">
        Open
      </span>
    </button>
  );
}

function ModelRow({
  model,
  selected,
  hasKey,
  favorite,
  showProviderIcon,
  badge,
  onPick,
  onToggleFavorite,
}: {
  model: ModelInfo;
  selected: boolean;
  hasKey: boolean;
  favorite: boolean;
  showProviderIcon: boolean;
  /** new: listed by the provider, not in the built-in list. unlisted: built
   *  in, but the provider's own list no longer has it. */
  badge?: "new" | "unlisted" | null;
  onPick: () => void;
  onToggleFavorite: () => void;
}) {
  return (
    <DropdownMenuItem
      onSelect={(e) => {
        e.preventDefault();
        onPick();
      }}
      className={cn(
        "group mx-1 my-0.5 flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5",
        selected ? "bg-accent/60 text-foreground" : "text-foreground/85",
        !hasKey && "opacity-60",
      )}
    >
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onToggleFavorite();
        }}
        title={favorite ? "Unfavorite" : "Favorite"}
        className={cn(
          "shrink-0 rounded p-0.5 transition-colors",
          favorite
            ? "text-amber-500"
            : "text-muted-foreground/40 hover:text-amber-500",
        )}
      >
        <HugeiconsIcon
          icon={StarIcon}
          size={12}
          strokeWidth={favorite ? 2 : 1.75}
          className={favorite ? "fill-amber-500" : ""}
        />
      </button>

      {showProviderIcon ? (
        <span title={providerTitle(model.provider)} className="relative shrink-0">
          <HugeiconsIcon
            icon={PROVIDER_ICON[model.provider]}
            size={13}
            strokeWidth={1.5}
            className="text-muted-foreground/70"
          />
          <span className="absolute -right-1 -bottom-1 flex size-2.5 items-center justify-center rounded-sm bg-popover">
            <HugeiconsIcon
              icon={ORIGIN_META[PROVIDER_ORIGINS[model.provider]].badge}
              size={7}
              strokeWidth={2.25}
              className="text-muted-foreground"
            />
          </span>
        </span>
      ) : null}

      <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
        <span className="shrink-0 text-[12px] font-medium leading-none">
          {model.label}
        </span>
        {badge === "new" ? (
          <span className="shrink-0 rounded bg-emerald-500/15 px-1 text-[9px] leading-[14px] font-medium text-emerald-700 dark:text-emerald-400">
            new
          </span>
        ) : badge === "unlisted" ? (
          <span
            title="The provider's model list no longer includes this model"
            className="shrink-0 rounded bg-muted px-1 text-[9px] leading-[14px] text-muted-foreground"
          >
            not listed
          </span>
        ) : null}
        <span className="truncate text-[10.5px] leading-none text-muted-foreground">
          {model.description}
        </span>
      </div>

      <CapabilityBars caps={model.capabilities} />

      {selected ? (
        <HugeiconsIcon
          icon={Tick01Icon}
          size={13}
          strokeWidth={2}
          className="shrink-0 text-foreground"
        />
      ) : null}
    </DropdownMenuItem>
  );
}

function CapabilityBars({ caps }: { caps: ModelCapabilities }) {
  return (
    <div className="ml-auto flex items-center gap-1.5">
      <CapBar icon={BrainIcon} value={caps.intelligence} label="Intelligence" />
      <CapBar icon={FlashIcon} value={caps.speed} label="Speed" />
      <CapBar
        icon={CoinsDollarIcon}
        value={caps.cost}
        label="Affordability"
      />
    </div>
  );
}

function CapBar({
  icon,
  value,
  label,
}: {
  icon: typeof AiBookIcon;
  value: number;
  label: string;
}) {
  return (
    <span
      className="flex items-center gap-0.5"
      title={`${label}: ${value}/5`}
    >
      <HugeiconsIcon
        icon={icon}
        size={10}
        strokeWidth={1.75}
        className="text-muted-foreground/60"
      />
      <span className="flex items-center gap-px">
        {[1, 2, 3, 4, 5].map((i) => (
          <span
            key={i}
            className={cn(
              "h-2 w-[2px] rounded-full",
              i <= value ? "bg-foreground/70" : "bg-foreground/15",
            )}
          />
        ))}
      </span>
    </span>
  );
}

function IconBtn({
  title,
  onClick,
  disabled,
  className,
  children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "size-6 shrink-0 rounded-md text-muted-foreground hover:text-foreground",
        className,
      )}
    >
      {children}
    </Button>
  );
}