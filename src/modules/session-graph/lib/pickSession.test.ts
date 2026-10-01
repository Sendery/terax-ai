import { describe, expect, it } from "vitest";

import { pickSession, type SessionCandidate } from "./pickSession";

const pi = (id: string, modifiedMs: number): SessionCandidate => ({
  id,
  agent: "pi",
  modifiedMs,
});
const claude = (id: string, modifiedMs: number): SessionCandidate => ({
  id,
  agent: "claude",
  modifiedMs,
});

describe("pickSession", () => {
  it("prefers the running agent even when the other has newer history", () => {
    const chosen = pickSession([claude("c1", 900), pi("p1", 100)], "pi");

    expect(chosen).toMatchObject({ id: "p1", agent: "pi" });
  });

  it("takes the newest transcript of the running agent", () => {
    const chosen = pickSession([pi("old", 100), pi("new", 500)], "pi");

    expect(chosen?.id).toBe("new");
  });

  it("falls back to the newest transcript when no agent is running", () => {
    // History stays useful after a session ends, so an exited agent must not
    // leave the panel empty.
    const chosen = pickSession([pi("p1", 100), claude("c1", 900)], null);

    expect(chosen).toMatchObject({ id: "c1", agent: "claude" });
  });

  it("falls back when the running agent has no history in this directory", () => {
    const chosen = pickSession([claude("c1", 900)], "pi");

    expect(chosen).toMatchObject({ id: "c1", agent: "claude" });
  });

  it("has nothing to show for a directory no agent ever ran in", () => {
    expect(pickSession([], "pi")).toBe(null);
    expect(pickSession([], null)).toBe(null);
  });

  it("does not mutate the candidates it was given", () => {
    const candidates = [pi("p1", 100), claude("c1", 900)];

    pickSession(candidates, null);

    expect(candidates.map((c) => c.id)).toEqual(["p1", "c1"]);
  });
});
