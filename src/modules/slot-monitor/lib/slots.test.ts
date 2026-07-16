import { describe, expect, it } from "vitest";
import {
  deriveSlotHealth,
  matchSlotForCwd,
  normalizePath,
  parseSlotMonitOutput,
  stripAnsi,
  type SlotInfo,
  type SlotServiceStatus,
} from "./slots";

type ServiceOverrides = Partial<Record<string, SlotServiceStatus>>;

function slotJson(opts: {
  slot: number;
  status?: string;
  worktree: string;
  agentWorktree?: string;
  worktreeExists?: boolean;
  running?: boolean;
  services?: ServiceOverrides;
  ticket?: string | null;
}): Record<string, unknown> {
  const services = {
    rails: "off",
    frontend: "off",
    anycable: "off",
    sidekiq: "off",
    console: "off",
    metro: "off",
    mastra: "off",
    karafka: "off",
    ...(opts.services ?? {}),
  };
  return {
    slot: opts.slot,
    status: opts.status ?? "active",
    branch: "feat/example",
    ticket: opts.ticket ?? null,
    worktree: opts.worktree,
    worktree_exists: opts.worktreeExists ?? true,
    agent_worktree: opts.agentWorktree ?? `${opts.worktree}-agent`,
    agent_exists: true,
    git: { dirty_count: 3, last_commit: "abc123 do things" },
    tmux: {
      session: `factorial-slot${opts.slot}`,
      running: opts.running ?? true,
      services,
    },
    ports: { rails: 8085, frontend: 8080, anycable: 8888, mastra: 4111 },
    docker: { anycable: "running", context: "colima" },
    created_at: "2026-07-07T10:52:00Z",
    claimed_at: "2026-07-07T10:52:00Z",
  };
}

function parseOne(obj: Record<string, unknown>): SlotInfo {
  const slots = parseSlotMonitOutput(JSON.stringify([obj]));
  expect(slots).toHaveLength(1);
  return slots[0];
}

describe("stripAnsi", () => {
  it("removes OSC 7/133 prompt markers a login shell prepends", () => {
    const raw =
      "\u001b]133;D;0\u001b\\\u001b]7;file://host/Users/a\u001b\\\u001b]133;A\u001b\\[{}]";
    expect(stripAnsi(raw)).toBe("[{}]");
  });

  it("removes CSI color sequences", () => {
    expect(stripAnsi("\u001b[32mgreen\u001b[0m")).toBe("green");
  });
});

describe("normalizePath", () => {
  it("converts backslashes and trims trailing slashes", () => {
    expect(normalizePath("C:\\a\\b\\")).toBe("C:/a/b");
    expect(normalizePath("/Users/a/slot-1/")).toBe("/Users/a/slot-1");
  });

  it("keeps root slash", () => {
    expect(normalizePath("/")).toBe("/");
  });
});

describe("parseSlotMonitOutput", () => {
  it("parses clean JSON output", () => {
    const raw = JSON.stringify([
      slotJson({ slot: 1, worktree: "/Users/a/pool/slot-1" }),
    ]);
    const slots = parseSlotMonitOutput(raw);
    expect(slots).toHaveLength(1);
    expect(slots[0].slot).toBe(1);
    expect(slots[0].worktree).toBe("/Users/a/pool/slot-1");
    expect(slots[0].tmux.session).toBe("factorial-slot1");
  });

  it("parses output polluted with prompt escape sequences", () => {
    const inner = JSON.stringify([
      slotJson({ slot: 6, worktree: "/Users/a/pool/slot-6" }),
    ]);
    const raw = `\u001b]133;D;0\u001b\\\u001b]7;file://h/Users/a\u001b\\\u001b]133;A\u001b\\${inner}`;
    const slots = parseSlotMonitOutput(raw);
    expect(slots).toHaveLength(1);
    expect(slots[0].slot).toBe(6);
  });

  it("returns empty array for empty, non-json, or non-array input", () => {
    expect(parseSlotMonitOutput("")).toEqual([]);
    expect(parseSlotMonitOutput("command not found")).toEqual([]);
    expect(parseSlotMonitOutput("{\"slot\":1}")).toEqual([]);
    expect(parseSlotMonitOutput("[")).toEqual([]);
  });

  it("skips malformed entries but keeps valid ones", () => {
    const raw = JSON.stringify([
      { slot: "nope" },
      null,
      slotJson({ slot: 2, worktree: "/Users/a/pool/slot-2" }),
    ]);
    const slots = parseSlotMonitOutput(raw);
    expect(slots).toHaveLength(1);
    expect(slots[0].slot).toBe(2);
  });

  it("defaults unknown service statuses to off", () => {
    const raw = JSON.stringify([
      slotJson({
        slot: 3,
        worktree: "/Users/a/pool/slot-3",
        services: { rails: "bogus" as SlotServiceStatus },
      }),
    ]);
    expect(parseSlotMonitOutput(raw)[0].tmux.services.rails).toBe("off");
  });
});

describe("matchSlotForCwd", () => {
  const slots = [
    parseOne(slotJson({ slot: 1, worktree: "/Users/a/pool/slot-1" })),
    parseOne(slotJson({ slot: 2, worktree: "/Users/a/pool/slot-2" })),
  ];

  it("matches an exact worktree path", () => {
    const m = matchSlotForCwd(slots, "/Users/a/pool/slot-1");
    expect(m?.slot.slot).toBe(1);
    expect(m?.via).toBe("worktree");
  });

  it("matches a nested subdirectory", () => {
    const m = matchSlotForCwd(slots, "/Users/a/pool/slot-2/backend/app");
    expect(m?.slot.slot).toBe(2);
  });

  it("matches the agent worktree", () => {
    const m = matchSlotForCwd(slots, "/Users/a/pool/slot-1-agent/x");
    expect(m?.slot.slot).toBe(1);
    expect(m?.via).toBe("agent");
  });

  it("does not match a sibling prefix that is not a path boundary", () => {
    expect(matchSlotForCwd(slots, "/Users/a/pool/slot-1x")).toBeNull();
  });

  it("returns null for missing cwd or no match", () => {
    expect(matchSlotForCwd(slots, null)).toBeNull();
    expect(matchSlotForCwd(slots, "/tmp/elsewhere")).toBeNull();
  });

  it("prefers the most specific (longest) matching base", () => {
    const nested = [
      parseOne(slotJson({ slot: 1, worktree: "/Users/a/pool" })),
      parseOne(slotJson({ slot: 2, worktree: "/Users/a/pool/slot-2" })),
    ];
    const m = matchSlotForCwd(nested, "/Users/a/pool/slot-2/src");
    expect(m?.slot.slot).toBe(2);
  });
});

describe("deriveSlotHealth", () => {
  it("is green when active, tmux up, and core services running", () => {
    const slot = parseOne(
      slotJson({
        slot: 1,
        status: "active",
        worktree: "/w",
        running: true,
        services: { rails: "up", frontend: "up" },
      }),
    );
    expect(deriveSlotHealth(slot)).toBe("green");
  });

  it("is red when the worktree is missing", () => {
    const slot = parseOne(
      slotJson({
        slot: 1,
        status: "active",
        worktree: "/w",
        worktreeExists: false,
        running: true,
        services: { rails: "up", frontend: "up" },
      }),
    );
    expect(deriveSlotHealth(slot)).toBe("red");
  });

  it("is red when any service pane has crashed", () => {
    const slot = parseOne(
      slotJson({
        slot: 1,
        status: "active",
        worktree: "/w",
        running: true,
        services: { rails: "up", frontend: "up", sidekiq: "down" },
      }),
    );
    expect(deriveSlotHealth(slot)).toBe("red");
  });

  it("is yellow when stopped (tmux off, services off)", () => {
    const slot = parseOne(
      slotJson({ slot: 1, status: "stopped", worktree: "/w", running: false }),
    );
    expect(deriveSlotHealth(slot)).toBe("yellow");
  });

  it("is yellow when active but core services are not up", () => {
    const slot = parseOne(
      slotJson({
        slot: 1,
        status: "active",
        worktree: "/w",
        running: true,
        services: { rails: "idle", frontend: "idle" },
      }),
    );
    expect(deriveSlotHealth(slot)).toBe("yellow");
  });
});
