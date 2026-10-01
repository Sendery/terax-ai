import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { SessionSourceGroup } from "./lib/terminalSources";
import { SessionSourcePicker } from "./SessionSourcePicker";

const NOW = 1_000_000_000;

const sources: SessionSourceGroup[] = [
  {
    tabId: 1,
    leafId: 10,
    tabTitle: "shell",
    cwd: "/repo",
    paneIndex: 0,
    paneCount: 1,
    key: "1:10",
    label: "shell",
    sessions: [
      { id: "session-alpha-1234", agent: "pi", modifiedMs: NOW - 120_000 },
      { id: "session-beta-5678", agent: "claude", modifiedMs: NOW - 7_200_000 },
    ],
  },
  {
    tabId: 2,
    leafId: 21,
    tabTitle: "build",
    cwd: "/repo/api",
    paneIndex: 0,
    paneCount: 2,
    key: "2:21",
    label: "build · pane 1",
    sessions: [],
  },
];

function render(
  overrides: Partial<Parameters<typeof SessionSourcePicker>[0]> = {},
) {
  return renderToStaticMarkup(
    <SessionSourcePicker
      sources={sources}
      boundTerminalKey="1:10"
      activeSessionId="session-alpha-1234"
      pinned={false}
      now={NOW}
      onFollowFocused={vi.fn()}
      onPickSession={vi.fn()}
      {...overrides}
    />,
  );
}

describe("SessionSourcePicker", () => {
  it("lists the sessions of every open terminal, not only the focused one", () => {
    const html = render();

    expect(html).toContain("shell");
    expect(html).toContain("build · pane 1");
    expect(html).toContain("/repo/api");
  });

  it("marks which terminal currently has focus", () => {
    expect(render()).toContain("focused");
  });

  it("shows a terminal that has no transcript rather than hiding it", () => {
    expect(render()).toContain("No transcript in this directory.");
  });

  it("marks the session being shown", () => {
    const html = render();
    const marked = html.slice(html.indexOf('aria-current="true"'));

    expect(marked).toContain("session-");
  });

  it("offers to go back to following the focused terminal when pinned", () => {
    const html = render({ pinned: true });

    expect(html).toContain("Follow the focused terminal");
    // Nothing in the terminal list is the implicit choice any more.
    expect(html.indexOf('aria-current="true"')).toBeGreaterThan(
      html.indexOf("Follow the focused terminal"),
    );
  });

  it("labels each session with its agent and age", () => {
    const html = render();

    expect(html).toContain("pi");
    expect(html).toContain("claude");
    expect(html).toContain("2m ago");
    expect(html).toContain("2h ago");
  });

  it("says so when no terminal is open", () => {
    expect(render({ sources: [] })).toContain("No terminal is open.");
  });
});
