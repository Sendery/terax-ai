import {
  AppleIcon,
  ChatGptIcon,
  ClaudeIcon,
  CommandLineIcon,
  ComputerIcon,
  CopilotIcon,
  CpuIcon,
  CreditCardIcon,
  CursorIcon,
  DeepseekIcon,
  FlashIcon,
  GlobeIcon,
  GoogleGeminiIcon,
  GravityIcon,
  Grok02Icon,
  Key01Icon,
  LaptopIcon,
  MistralIcon,
  PiIcon,
  PlugIcon,
  ServerStack01Icon,
  SourceCodeIcon,
} from "@hugeicons/core-free-icons";
import { PROVIDERS, type ProviderId } from "@/modules/ai/config";

type Icon = typeof ChatGptIcon;

/** How a provider is reached: an API key, a paid plan's sign-in, an installed
 *  agent CLI, or a model served on this machine or network. */
export type ProviderOrigin = "api" | "subscription" | "cli" | "local";

export const PROVIDER_ORIGINS: Record<ProviderId, ProviderOrigin> = {
  openai: "api",
  anthropic: "api",
  google: "api",
  xai: "api",
  cerebras: "api",
  groq: "api",
  deepseek: "api",
  mistral: "api",
  openrouter: "api",
  "chatgpt-codex": "subscription",
  "openai-compatible": "local",
  lmstudio: "local",
  mlx: "local",
  ollama: "local",
  "cli-claude": "cli",
  "cli-codex": "cli",
  "cli-cursor": "cli",
  "cli-opencode": "cli",
  "cli-pi": "cli",
  "cli-agy": "cli",
  "cli-copilot": "cli",
};

/**
 * One mark per provider. A vendor keeps its brand across origins (OpenAI's
 * API, ChatGPT sign-in and Codex CLI are all OpenAI); the origin badge is
 * what tells them apart. Unrelated providers never share a mark.
 */
export const PROVIDER_ICONS: Record<ProviderId, Icon> = {
  openai: ChatGptIcon,
  anthropic: ClaudeIcon,
  google: GoogleGeminiIcon,
  xai: Grok02Icon,
  cerebras: CpuIcon,
  groq: FlashIcon,
  deepseek: DeepseekIcon,
  mistral: MistralIcon,
  openrouter: GlobeIcon,
  "openai-compatible": PlugIcon,
  lmstudio: ComputerIcon,
  mlx: AppleIcon,
  ollama: ServerStack01Icon,
  "chatgpt-codex": ChatGptIcon,
  "cli-claude": ClaudeIcon,
  "cli-codex": ChatGptIcon,
  "cli-cursor": CursorIcon,
  "cli-opencode": SourceCodeIcon,
  "cli-pi": PiIcon,
  "cli-agy": GravityIcon,
  "cli-copilot": CopilotIcon,
};

export const ORIGIN_META: Record<
  ProviderOrigin,
  { label: string; badge: Icon; title: string }
> = {
  api: { label: "API", badge: Key01Icon, title: "API key" },
  subscription: { label: "Plan", badge: CreditCardIcon, title: "Subscription sign-in" },
  cli: { label: "CLI", badge: CommandLineIcon, title: "Installed agent CLI" },
  local: { label: "Local", badge: LaptopIcon, title: "Local or self-hosted" },
};

export const ORIGIN_ORDER: readonly ProviderOrigin[] = ["api", "subscription", "cli", "local"];

/** "Codex · CLI": the vendor without the origin suffix, then the origin. */
export function providerTitle(id: ProviderId): string {
  const p = PROVIDERS.find((x) => x.id === id);
  const label = (p?.label ?? id).replace(/\s*\((CLI|API)\)\s*$/, "");
  return `${label} · ${ORIGIN_META[PROVIDER_ORIGINS[id]].label}`;
}

/**
 * The picker's provider rail: grouped by origin in a fixed order, configured
 * providers first inside each group, catalogue order otherwise. Groups with
 * no provider are dropped.
 */
export function groupProviders<T extends { id: ProviderId }>(
  providers: readonly T[],
  isConfigured: (id: ProviderId) => boolean,
): { origin: ProviderOrigin; providers: T[] }[] {
  return ORIGIN_ORDER.map((origin) => {
    const inGroup = providers.filter((p) => PROVIDER_ORIGINS[p.id] === origin);
    return {
      origin,
      providers: [
        ...inGroup.filter((p) => isConfigured(p.id)),
        ...inGroup.filter((p) => !isConfigured(p.id)),
      ],
    };
  }).filter((g) => g.providers.length > 0);
}
