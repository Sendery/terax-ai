import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { AgentMonitorRow } from "../lib/monitor";
import { AgentMonitorRowView } from "./AgentMonitorPanel";

const NOW = new Date(2026, 0, 5, 12, 0).getTime();

const row: AgentMonitorRow = {
  leafId: 1,
  tabId: 10,
  agent: "claude",
  sessionName: "release notes",
  state: "needs-input",
  startedAt: new Date(2026, 0, 5, 9, 4).getTime(),
  lastActivityAt: NOW - 30 * 60_000,
  lastNotificationAt: NOW - 30 * 60_000,
  integrationLabel: "Native hook",
  harness: "claude",
  tabColor: null,
  task: null,
  cwd: null,
};

function render(over: Partial<AgentMonitorRow> = {}): string {
  return renderToStaticMarkup(
    <AgentMonitorRowView row={{ ...row, ...over }} now={NOW} onActivate={() => {}} />,
  );
}

describe("AgentMonitorRowView", () => {
  it("names the row after the session rather than the provider", () => {
    const html = render();

    expect(html).toContain(">release notes<");
    expect(html).not.toContain(">claude<");
    expect(html).not.toContain(">Claude Code<");
  });

  it("shows when the session started and how long since it last notified", () => {
    const html = render();

    expect(html).toContain("Started 09:04");
    expect(html).toContain("Notified 30m ago");
  });

  it("says a session has not notified rather than implying it just did", () => {
    const html = render({ lastNotificationAt: null });

    expect(html).toContain("No notifications yet");
    expect(html).not.toContain("Notified");
  });

  it("omits the start time instead of printing a placeholder for a missing one", () => {
    const html = render({ startedAt: 0 });

    expect(html).not.toContain("Started");
    expect(html).toContain("Notified 30m ago");
  });

  it("keeps the provider and state in the accessible name the brand mark stands for", () => {
    const html = render({ lastNotificationAt: null });

    expect(html).toContain(
      'aria-label="release notes, Claude Code, Needs input, started 09:04, no notifications yet"',
    );
  });

  it("still shows the integration and the managed task", () => {
    const html = render({ task: "Add monitor", cwd: "/work/terax" });

    expect(html).toContain("Native hook");
    expect(html).toContain("Add monitor");
    expect(html).toContain("/work/terax");
  });
});
