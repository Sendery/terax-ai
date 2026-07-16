export const SLOT_SERVICES = [
  "rails",
  "frontend",
  "anycable",
  "sidekiq",
  "console",
  "metro",
  "mastra",
  "karafka",
] as const;

export type SlotService = (typeof SLOT_SERVICES)[number];

export const SLOT_SERVICE_LABELS: Record<SlotService, string> = {
  rails: "Rails",
  frontend: "Frontend",
  anycable: "AnyCable",
  sidekiq: "Sidekiq",
  console: "Console",
  metro: "Metro",
  mastra: "Mastra",
  karafka: "Karafka",
};

export type SlotServiceStatus = "up" | "idle" | "down" | "off";

export type SlotStatus =
  | "active"
  | "stopped"
  | "idle"
  | "setup"
  | "unknown"
  | (string & {});

export type SlotHealth = "green" | "yellow" | "red";

export type SlotInfo = {
  slot: number;
  status: SlotStatus;
  branch: string;
  ticket: string | null;
  worktree: string;
  worktreeExists: boolean;
  agentWorktree: string;
  agentExists: boolean;
  git: { dirtyCount: number; lastCommit: string };
  tmux: {
    session: string;
    running: boolean;
    services: Record<SlotService, SlotServiceStatus>;
  };
  ports: { rails: number; frontend: number; anycable: number; mastra: number };
  docker: { anycable: string; context: string };
  createdAt: string | null;
  claimedAt: string | null;
};

export type SlotMatch = { slot: SlotInfo; via: "worktree" | "agent" };

const SERVICE_STATUSES: readonly SlotServiceStatus[] = [
  "up",
  "idle",
  "down",
  "off",
];

/**
 * Strips ANSI/OSC escape sequences. `slot-monit --json` prints clean JSON, but
 * an interactive login shell prepends OSC 7/133 prompt markers to stdout.
 */
export function stripAnsi(input: string): string {
  return input
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, "")
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
}

function toForwardSlash(p: string): string {
  return p.replace(/\\/g, "/");
}

export function normalizePath(p: string): string {
  const forward = toForwardSlash(p).trim();
  if (forward.length > 1 && forward.endsWith("/")) {
    return forward.replace(/\/+$/, "");
  }
  return forward;
}

function coerceServiceStatus(value: unknown): SlotServiceStatus {
  return typeof value === "string" &&
    (SERVICE_STATUSES as readonly string[]).includes(value)
    ? (value as SlotServiceStatus)
    : "off";
}

function coerceString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function coerceNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function coerceNullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function normalizeSlot(raw: unknown): SlotInfo | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const slot = coerceNumber(r.slot, NaN);
  if (!Number.isInteger(slot)) return null;

  const git = (r.git ?? {}) as Record<string, unknown>;
  const tmux = (r.tmux ?? {}) as Record<string, unknown>;
  const tmuxServices = (tmux.services ?? {}) as Record<string, unknown>;
  const ports = (r.ports ?? {}) as Record<string, unknown>;
  const docker = (r.docker ?? {}) as Record<string, unknown>;

  const services = {} as Record<SlotService, SlotServiceStatus>;
  for (const svc of SLOT_SERVICES) {
    services[svc] = coerceServiceStatus(tmuxServices[svc]);
  }

  return {
    slot,
    status: coerceString(r.status, "unknown"),
    branch: coerceString(r.branch, "-"),
    ticket: coerceNullableString(r.ticket),
    worktree: normalizePath(coerceString(r.worktree)),
    worktreeExists: r.worktree_exists === true,
    agentWorktree: normalizePath(coerceString(r.agent_worktree)),
    agentExists: r.agent_exists === true,
    git: {
      dirtyCount: coerceNumber(git.dirty_count, 0),
      lastCommit: coerceString(git.last_commit, "-"),
    },
    tmux: {
      session: coerceString(tmux.session, "-"),
      running: tmux.running === true,
      services,
    },
    ports: {
      rails: coerceNumber(ports.rails, 0),
      frontend: coerceNumber(ports.frontend, 0),
      anycable: coerceNumber(ports.anycable, 0),
      mastra: coerceNumber(ports.mastra, 0),
    },
    docker: {
      anycable: coerceString(docker.anycable, "missing"),
      context: coerceString(docker.context, "-"),
    },
    createdAt: coerceNullableString(r.created_at),
    claimedAt: coerceNullableString(r.claimed_at),
  };
}

function extractJsonArray(text: string): string | null {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return null;
  return text.slice(start, end + 1);
}

/**
 * Parses `slot-monit all --json` stdout into validated slots. Returns an empty
 * array for unavailable, empty, or malformed output rather than throwing.
 */
export function parseSlotMonitOutput(raw: string): SlotInfo[] {
  if (!raw) return [];
  const cleaned = stripAnsi(raw);
  const json = extractJsonArray(cleaned);
  if (!json) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const slots: SlotInfo[] = [];
  for (const entry of parsed) {
    const normalized = normalizeSlot(entry);
    if (normalized) slots.push(normalized);
  }
  return slots;
}

function isInside(cwd: string, base: string): boolean {
  if (!base) return false;
  return cwd === base || cwd.startsWith(`${base}/`);
}

/**
 * Finds the slot whose worktree (or agent worktree) contains `cwd`. When
 * several bases match, the most specific (longest) wins.
 */
export function matchSlotForCwd(
  slots: readonly SlotInfo[],
  cwd: string | null | undefined,
): SlotMatch | null {
  if (!cwd) return null;
  const normalizedCwd = normalizePath(cwd);
  if (!normalizedCwd) return null;

  let best: SlotMatch | null = null;
  let bestLen = -1;
  for (const slot of slots) {
    const candidates: { base: string; via: "worktree" | "agent" }[] = [
      { base: slot.worktree, via: "worktree" },
      { base: slot.agentWorktree, via: "agent" },
    ];
    for (const { base, via } of candidates) {
      if (isInside(normalizedCwd, base) && base.length > bestLen) {
        best = { slot, via };
        bestLen = base.length;
      }
    }
  }
  return best;
}

const CORE_SERVICES: readonly SlotService[] = ["rails", "frontend"];

/**
 * Maps a slot to a traffic-light health:
 * - red: worktree missing or any service pane crashed (`down`);
 * - green: claimed active, tmux up, and core services running;
 * - yellow: everything else (stopped, idle, setup, partially up).
 */
export function deriveSlotHealth(slot: SlotInfo): SlotHealth {
  if (!slot.worktreeExists) return "red";
  const anyDown = SLOT_SERVICES.some(
    (svc) => slot.tmux.services[svc] === "down",
  );
  if (anyDown) return "red";
  const coreUp = CORE_SERVICES.every(
    (svc) => slot.tmux.services[svc] === "up",
  );
  if (slot.status === "active" && slot.tmux.running && coreUp) return "green";
  return "yellow";
}
