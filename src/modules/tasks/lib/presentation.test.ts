import { describe, expect, it } from "vitest";

import {
  formatCost,
  formatCountdown,
  formatDuration,
  formatTokens,
  missedPolicyLabel,
  modeLabel,
  scheduleLabel,
  targetLabel,
  taskAccessibleLabel,
} from "./presentation";
import { createTask, type ScheduledTask } from "./task";

const NOW = new Date(2026, 7, 3, 9).getTime();

function make(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    ...createTask(
      {
        name: "Watch CI",
        prompt: "check ci",
        cwd: "/tmp",
        schedule: { kind: "everyN", minutes: 60 },
      },
      NOW,
    ),
    ...overrides,
  };
}

describe("scheduleLabel", () => {
  it("describes each schedule kind in plain language", () => {
    expect(scheduleLabel({ kind: "manual" })).toBe("Manual only");
    expect(scheduleLabel({ kind: "everyN", minutes: 1 })).toBe("Every minute");
    expect(scheduleLabel({ kind: "everyN", minutes: 45 })).toBe("Every 45 min");
    expect(scheduleLabel({ kind: "everyN", minutes: 60 })).toBe("Every hour");
    expect(scheduleLabel({ kind: "everyN", minutes: 180 })).toBe("Every 3 h");
    expect(scheduleLabel({ kind: "everyN", minutes: 1440 })).toBe("Every day");
    expect(
      scheduleLabel({ kind: "weekly", days: [1, 2, 3, 4, 5], time: "08:00" }),
    ).toBe("Weekdays at 08:00");
    expect(scheduleLabel({ kind: "weekly", days: [0, 6], time: "10:30" })).toBe(
      "Weekends at 10:30",
    );
    expect(scheduleLabel({ kind: "weekly", days: [2], time: "07:15" })).toBe(
      "Tue at 07:15",
    );
    expect(
      scheduleLabel({ kind: "weekly", days: [1, 3], time: "07:15" }),
    ).toBe("Mon, Wed at 07:15");
    expect(
      scheduleLabel({
        kind: "everyNDays",
        days: 1,
        time: "06:00",
        from: "2026-08-01",
      }),
    ).toBe("Daily at 06:00");
    expect(
      scheduleLabel({
        kind: "everyNDays",
        days: 3,
        time: "06:00",
        from: "2026-08-01",
      }),
    ).toBe("Every 3 days at 06:00");
    expect(
      scheduleLabel({ kind: "dates", dates: ["2026-08-04"], time: "12:00" }),
    ).toBe("1 date at 12:00");
    expect(
      scheduleLabel({
        kind: "dates",
        dates: ["2026-08-04", "2026-08-09"],
        time: "12:00",
      }),
    ).toBe("2 dates at 12:00");
  });
});

describe("formatCountdown", () => {
  it("reads as a wait, not a timestamp", () => {
    expect(formatCountdown(NOW + 45_000, NOW)).toBe("in 45s");
    expect(formatCountdown(NOW + 90_000, NOW)).toBe("in 1m");
    expect(formatCountdown(NOW + 3_600_000, NOW)).toBe("in 1h");
    expect(formatCountdown(NOW + 5_400_000, NOW)).toBe("in 1h 30m");
    expect(formatCountdown(NOW + 172_800_000, NOW)).toBe("in 2d");
  });

  it("marks an overdue or absent schedule", () => {
    expect(formatCountdown(NOW - 1_000, NOW)).toBe("due now");
    expect(formatCountdown(null, NOW)).toBe("not scheduled");
    expect(formatCountdown(undefined, NOW)).toBe("not scheduled");
  });
});

describe("formatDuration", () => {
  it("stays compact across magnitudes", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(950)).toBe("0.9s");
    expect(formatDuration(45_000)).toBe("45s");
    expect(formatDuration(90_000)).toBe("1m 30s");
    expect(formatDuration(3_600_000)).toBe("1h 0m");
  });
});

describe("formatTokens", () => {
  it("abbreviates large counts", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(999)).toBe("999");
    expect(formatTokens(1_500)).toBe("1.5k");
    expect(formatTokens(81_231)).toBe("81.2k");
    expect(formatTokens(2_400_000)).toBe("2.4M");
  });
});

describe("formatCost", () => {
  it("keeps small costs legible", () => {
    expect(formatCost(0)).toBe("$0.00");
    expect(formatCost(0.0001)).toBe("<$0.01");
    expect(formatCost(0.1325)).toBe("$0.13");
    expect(formatCost(12.5)).toBe("$12.50");
  });
});

describe("labels", () => {
  it("names the closed sets for the UI", () => {
    expect(modeLabel("task")).toBe("Task");
    expect(modeLabel("routine")).toBe("Routine");
    expect(targetLabel("tab")).toBe("Terminal tab");
    expect(targetLabel("headless")).toBe("Headless");
    expect(missedPolicyLabel("runOnce")).toBe("Recover once");
    expect(missedPolicyLabel("skip")).toBe("Skip missed");
    expect(missedPolicyLabel("runAll")).toBe("Recover all");
    expect(missedPolicyLabel("askOnResume")).toBe("Ask on resume");
  });
});

describe("taskAccessibleLabel", () => {
  it("announces name, cadence, state and next run together", () => {
    const label = taskAccessibleLabel(
      make({ nextRunAt: NOW + 3_600_000 }),
      NOW,
    );
    expect(label).toBe("Watch CI, Every hour, Pi, enabled, in 1h");
  });

  it("announces the disabled state instead of relying on colour", () => {
    const label = taskAccessibleLabel(
      make({ enabled: false, nextRunAt: null }),
      NOW,
    );
    expect(label).toBe("Watch CI, Every hour, Pi, disabled, not scheduled");
  });

  it("announces a spent run budget", () => {
    const label = taskAccessibleLabel(
      make({ maxRuns: 3, runCount: 3, nextRunAt: null }),
      NOW,
    );
    expect(label).toBe(
      "Watch CI, Every hour, Pi, enabled, run budget spent, not scheduled",
    );
  });

  it("announces a run in progress", () => {
    const label = taskAccessibleLabel(make(), NOW, { running: true });
    expect(label).toContain("running now");
  });

  it("announces which agent the task drives, since the card shows it", () => {
    expect(taskAccessibleLabel(make({ agent: "claude" }), NOW)).toContain(
      "Claude Code",
    );
    expect(taskAccessibleLabel(make({ agent: "codex" }), NOW)).toContain("Codex");
  });
});
