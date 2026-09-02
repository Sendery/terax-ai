import { describe, expect, it } from "vitest";
import {
  buildRestoreSnapshot,
  claimSessionId,
  isSavedAgentSession,
  MAX_RESTORABLE_SESSIONS,
  matchRestoreTargets,
  parseRestoreSnapshot,
  resumeCommandLine,
  type SavedAgentSession,
} from "./restore";

function session(patch: Partial<SavedAgentSession> = {}): SavedAgentSession {
  return {
    agent: "claude",
    cwd: "/home/ana/code",
    spaceId: "sp-1",
    sessionId: "9f1c4d2e-0000-4000-8000-000000000000",
    tabIndex: 0,
    tabTitle: "code",
    startedAt: 1_700_000_000_000,
    ...patch,
  };
}

describe("isSavedAgentSession", () => {
  it("keeps a session that names the transcript it would resume", () => {
    expect(isSavedAgentSession(session())).toBe(true);
  });

  it("refuses pi and claude entries with no session to resume", () => {
    expect(isSavedAgentSession(session({ sessionId: undefined }))).toBe(false);
    expect(
      isSavedAgentSession(session({ agent: "pi", sessionId: undefined })),
    ).toBe(false);
  });

  it("accepts codex only without an id, because codex mints its own", () => {
    expect(
      isSavedAgentSession(session({ agent: "codex", sessionId: undefined })),
    ).toBe(true);
    expect(isSavedAgentSession(session({ agent: "codex" }))).toBe(false);
  });

  it("refuses an id that could reach the shell as something other than an id", () => {
    for (const bad of ["../../etc", "a b", "--dangerous", "$(id)", ""]) {
      expect(isSavedAgentSession(session({ sessionId: bad }))).toBe(false);
    }
  });

  it("refuses an unknown agent", () => {
    expect(isSavedAgentSession(session({ agent: "cursor" as never }))).toBe(
      false,
    );
  });
});

describe("buildRestoreSnapshot", () => {
  it("drops entries that could not be reopened", () => {
    const snapshot = buildRestoreSnapshot(
      [session(), session({ sessionId: undefined }), session({ cwd: "" })],
      5,
    );
    expect(snapshot.sessions).toHaveLength(1);
    expect(snapshot.savedAt).toBe(5);
  });

  it("collapses two leaves that resolved to the same transcript", () => {
    const snapshot = buildRestoreSnapshot(
      [session({ tabIndex: 0 }), session({ tabIndex: 3 })],
      5,
    );
    expect(snapshot.sessions).toHaveLength(1);
  });

  it("bounds how much a stored file can make the next launch spend", () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      session({ cwd: `/repo/${i}` }),
    );
    expect(buildRestoreSnapshot(many, 1).sessions).toHaveLength(
      MAX_RESTORABLE_SESSIONS,
    );
  });
});

describe("parseRestoreSnapshot", () => {
  it("reads back what it wrote", () => {
    const written = buildRestoreSnapshot([session()], 7);
    expect(parseRestoreSnapshot(JSON.parse(JSON.stringify(written)))).toEqual(
      written,
    );
  });

  it("reports nothing to restore rather than a partial snapshot", () => {
    expect(parseRestoreSnapshot(null)).toBeNull();
    expect(parseRestoreSnapshot({ version: 1, sessions: [] })).toBeNull();
    expect(
      parseRestoreSnapshot({ version: 2, sessions: [session()] }),
    ).toBeNull();
  });

  it("keeps the valid entries of a partly corrupted file", () => {
    const snapshot = parseRestoreSnapshot({
      version: 1,
      savedAt: 3,
      sessions: [{ agent: "claude" }, session({ cwd: "/other" })],
    });
    expect(snapshot?.sessions.map((s) => s.cwd)).toEqual(["/other"]);
  });
});

describe("resumeCommandLine", () => {
  it("resumes claude by id", () => {
    expect(resumeCommandLine(session(), "posix")).toBe(
      "cd /home/ana/code && claude --resume 9f1c4d2e-0000-4000-8000-000000000000",
    );
  });

  it("resumes pi by session", () => {
    const line = resumeCommandLine(
      session({ agent: "pi", sessionId: "terax-42" }),
      "posix",
    );
    expect(line).toBe("cd /home/ana/code && pi --session terax-42");
  });

  it("resumes codex by directory, since it names no session", () => {
    const line = resumeCommandLine(
      session({ agent: "codex", sessionId: undefined }),
      "posix",
    );
    expect(line).toBe("cd /home/ana/code && codex resume --last");
  });

  it("quotes a directory the shell would otherwise split", () => {
    const line = resumeCommandLine(
      session({ agent: "codex", sessionId: undefined, cwd: "/home/my code" }),
      "posix",
    );
    expect(line).toBe("cd '/home/my code' && codex resume --last");
  });
});

describe("matchRestoreTargets", () => {
  const tabs = [
    { id: 10, kind: "terminal", spaceId: "sp-1", cwd: "/a" },
    { id: 11, kind: "editor", spaceId: "sp-1" },
    { id: 12, kind: "terminal", spaceId: "sp-1", cwd: "/b" },
    { id: 20, kind: "terminal", spaceId: "sp-2", cwd: "/a" },
  ];

  it("resumes into the tab the space serializer already restored", () => {
    const [target] = matchRestoreTargets(
      [session({ cwd: "/b", tabIndex: 2 })],
      tabs,
    );
    expect(target.tabId).toBe(12);
  });

  it("stays inside the session's own space", () => {
    const [target] = matchRestoreTargets(
      [session({ cwd: "/a", spaceId: "sp-2", tabIndex: 0 })],
      tabs,
    );
    expect(target.tabId).toBe(20);
  });

  it("falls back to a directory match when the tab moved", () => {
    const [target] = matchRestoreTargets(
      [session({ cwd: "/b", tabIndex: 0 })],
      tabs,
    );
    expect(target.tabId).toBe(12);
  });

  it("asks for a new tab when nothing matches", () => {
    const [target] = matchRestoreTargets(
      [session({ cwd: "/gone", tabIndex: 9 })],
      tabs,
    );
    expect(target.tabId).toBeNull();
  });

  it("never resumes two sessions into one tab", () => {
    const targets = matchRestoreTargets(
      [
        session({ cwd: "/a", tabIndex: 0, sessionId: "one" }),
        session({ cwd: "/a", tabIndex: 0, sessionId: "two" }),
      ],
      tabs,
    );
    expect(targets.map((t) => t.tabId)).toEqual([10, null]);
  });
});

describe("claimSessionId", () => {
  it("prefers the transcript that appeared after the agent started", () => {
    expect(
      claimSessionId({
        listed: ["fresh", "old"],
        before: new Set(["old"]),
        claimed: new Set(),
      }),
    ).toBe("fresh");
  });

  it("still resolves an agent that was resumed into an existing transcript", () => {
    expect(
      claimSessionId({
        listed: ["old"],
        before: new Set(["old"]),
        claimed: new Set(),
      }),
    ).toBe("old");
  });

  it("never hands one transcript to two leaves", () => {
    expect(
      claimSessionId({
        listed: ["one", "two"],
        before: new Set(),
        claimed: new Set(["one"]),
      }),
    ).toBe("two");
  });

  it("rejects an id that does not match the safe shape", () => {
    expect(
      claimSessionId({
        listed: ["../escape"],
        before: new Set(),
        claimed: new Set(),
      }),
    ).toBeNull();
  });
});
