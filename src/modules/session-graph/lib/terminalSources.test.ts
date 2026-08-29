import { describe, expect, it } from "vitest";
import {
  buildSessionGroups,
  collectTerminalSources,
  nextTerminalBinding,
  type TerminalBinding,
  type TerminalSource,
  type TerminalSourceTab,
} from "./terminalSources";

const shell: TerminalSourceTab = {
  id: 1,
  title: "shell",
  cwd: "/repo",
  activeLeafId: 10,
  paneTree: { kind: "leaf", id: 10, cwd: "/repo" },
};

const split: TerminalSourceTab = {
  id: 2,
  title: "build",
  cwd: "/repo",
  activeLeafId: 21,
  paneTree: {
    kind: "split",
    id: 20,
    dir: "row",
    children: [
      { kind: "leaf", id: 21, cwd: "/repo/api" },
      { kind: "leaf", id: 22, cwd: "/repo/web" },
    ],
  },
};

describe("collectTerminalSources", () => {
  it("lists one entry per terminal pane", () => {
    expect(collectTerminalSources([shell, split])).toEqual([
      {
        tabId: 1,
        leafId: 10,
        tabTitle: "shell",
        cwd: "/repo",
        paneIndex: 0,
        paneCount: 1,
      },
      {
        tabId: 2,
        leafId: 21,
        tabTitle: "build",
        cwd: "/repo/api",
        paneIndex: 0,
        paneCount: 2,
      },
      {
        tabId: 2,
        leafId: 22,
        tabTitle: "build",
        cwd: "/repo/web",
        paneIndex: 1,
        paneCount: 2,
      },
    ]);
  });

  it("falls back to the tab cwd for a pane that has not reported one yet", () => {
    const pending: TerminalSourceTab = {
      ...shell,
      paneTree: { kind: "leaf", id: 10 },
    };

    expect(collectTerminalSources([pending])[0].cwd).toBe("/repo");
  });

  it("drops panes with no directory at all", () => {
    const unknown: TerminalSourceTab = {
      id: 3,
      title: "new",
      cwd: null,
      activeLeafId: 30,
      paneTree: { kind: "leaf", id: 30 },
    };

    expect(collectTerminalSources([unknown])).toEqual([]);
  });
});

describe("nextTerminalBinding", () => {
  const a: TerminalBinding = {
    tabId: 1,
    leafId: 10,
    tabTitle: "shell",
    cwd: "/repo",
  };
  const b: TerminalBinding = {
    tabId: 2,
    leafId: 21,
    tabTitle: "build",
    cwd: "/repo/api",
  };

  it("follows the focused terminal", () => {
    expect(nextTerminalBinding(a, b, [1, 2])).toEqual(b);
  });

  it("keeps the last terminal while a non-terminal tab has focus", () => {
    // Opening a file or a diagram must not throw away the transcript the user
    // is reading.
    expect(nextTerminalBinding(a, null, [1, 2])).toEqual(a);
  });

  it("releases the binding when its terminal is closed", () => {
    expect(nextTerminalBinding(a, null, [2])).toBeNull();
  });

  it("has nothing to bind before a terminal is ever focused", () => {
    expect(nextTerminalBinding(null, null, [1])).toBeNull();
  });

  it("keeps the same object when nothing changed, so the probe does not rerun", () => {
    expect(nextTerminalBinding(a, { ...a }, [1])).toBe(a);
  });
});

describe("buildSessionGroups", () => {
  const sources: TerminalSource[] = [
    {
      tabId: 1,
      leafId: 10,
      tabTitle: "shell",
      cwd: "/repo",
      paneIndex: 0,
      paneCount: 1,
    },
    {
      tabId: 2,
      leafId: 21,
      tabTitle: "build",
      cwd: "/repo/api",
      paneIndex: 0,
      paneCount: 2,
    },
    {
      tabId: 2,
      leafId: 22,
      tabTitle: "build",
      cwd: "/repo/web",
      paneIndex: 1,
      paneCount: 2,
    },
  ];
  const byCwd = new Map([
    ["/repo", [{ id: "s1", agent: "pi" as const, modifiedMs: 2 }]],
    ["/repo/api", [{ id: "s2", agent: "claude" as const, modifiedMs: 1 }]],
  ]);

  it("labels a single-pane terminal by its tab title", () => {
    expect(buildSessionGroups(sources, byCwd)[0]).toMatchObject({
      label: "shell",
      cwd: "/repo",
      sessions: [{ id: "s1" }],
    });
  });

  it("distinguishes the panes of a split terminal", () => {
    const groups = buildSessionGroups(sources, byCwd);

    expect(groups[1].label).toBe("build · pane 1");
    expect(groups[2].label).toBe("build · pane 2");
  });

  it("keeps a terminal with no transcript so the user sees it is empty", () => {
    expect(buildSessionGroups(sources, byCwd)[2].sessions).toEqual([]);
  });

  it("gives every pane a distinct key", () => {
    const keys = buildSessionGroups(sources, byCwd).map((group) => group.key);

    expect(new Set(keys).size).toBe(keys.length);
  });

  it("sorts sessions newest first", () => {
    const groups = buildSessionGroups(
      [sources[0]],
      new Map([
        [
          "/repo",
          [
            { id: "old", agent: "pi" as const, modifiedMs: 1 },
            { id: "new", agent: "pi" as const, modifiedMs: 9 },
          ],
        ],
      ]),
    );

    expect(groups[0].sessions.map((s) => s.id)).toEqual(["new", "old"]);
  });
});
