import { beforeEach, describe, expect, it } from "vitest";
import {
  aggregateAgentPhases,
  phaseForSignal,
  useAgentActivityStore,
} from "./agentActivity";

describe("phaseForSignal", () => {
  it("maps lifecycle kinds to phases", () => {
    expect(phaseForSignal("started")).toBe("working");
    expect(phaseForSignal("working")).toBe("working");
    expect(phaseForSignal("attention")).toBe("attention");
    expect(phaseForSignal("finished")).toBe("finished");
    expect(phaseForSignal("exited")).toBe("exited");
  });

  it("ignores unknown kinds", () => {
    expect(phaseForSignal("bogus")).toBeNull();
    expect(phaseForSignal("")).toBeNull();
  });
});

describe("aggregateAgentPhases", () => {
  it("returns null top for no matching ptys", () => {
    expect(aggregateAgentPhases({}, [])).toEqual({
      top: null,
      count: 0,
      reason: null,
    });
    expect(aggregateAgentPhases({ 1: "idle" }, [1])).toEqual({
      top: null,
      count: 0,
      reason: null,
    });
  });

  it("counts only agents in the winning phase", () => {
    const phases = { 1: "working", 2: "working", 3: "attention" } as const;
    // attention outranks working; count reflects the single attention agent.
    expect(aggregateAgentPhases(phases, [1, 2, 3])).toEqual({
      top: "attention",
      count: 1,
      reason: null,
    });
  });

  it("orders attention > working > finished", () => {
    expect(
      aggregateAgentPhases({ 1: "working", 2: "finished" }, [1, 2]),
    ).toEqual({ top: "working", count: 1, reason: null });
    expect(
      aggregateAgentPhases({ 1: "finished", 2: "finished" }, [1, 2]),
    ).toEqual({ top: "finished", count: 2, reason: null });
  });

  it("names the most pressing known cause among the agents needing input", () => {
    const phases = { 1: "attention", 2: "attention", 3: "attention" } as const;
    expect(
      aggregateAgentPhases(phases, [1, 2, 3], { 1: "idle", 2: "permission" }),
    ).toEqual({ top: "attention", count: 3, reason: "permission" });
    expect(aggregateAgentPhases(phases, [3], { 1: "idle" })).toEqual({
      top: "attention",
      count: 1,
      reason: null,
    });
  });

  it("only considers the given ptyIds", () => {
    const phases = { 1: "attention", 2: "working" } as const;
    expect(aggregateAgentPhases(phases, [2])).toEqual({
      top: "working",
      count: 1,
      reason: null,
    });
  });
});

describe("useAgentActivityStore", () => {
  beforeEach(() => useAgentActivityStore.setState({ phases: {}, reasons: {} }));

  it("keeps a stable reference when the phase is unchanged", () => {
    const { setPhase } = useAgentActivityStore.getState();
    setPhase(1, "working");
    const first = useAgentActivityStore.getState().phases;
    setPhase(1, "working");
    // No churn on repeated identical signals, so subscribers do not re-render.
    expect(useAgentActivityStore.getState().phases).toBe(first);
  });

  it("keeps a cause only while the pty needs attention", () => {
    const { setPhase } = useAgentActivityStore.getState();
    setPhase(1, "attention", "question");
    expect(useAgentActivityStore.getState().reasons[1]).toBe("question");
    setPhase(1, "working", "question");
    expect(1 in useAgentActivityStore.getState().reasons).toBe(false);
  });

  it("drops a pty on clear", () => {
    const { setPhase, clear } = useAgentActivityStore.getState();
    setPhase(1, "attention");
    setPhase(2, "attention", "idle");
    clear(1);
    clear(2);
    expect(1 in useAgentActivityStore.getState().phases).toBe(false);
    expect(2 in useAgentActivityStore.getState().reasons).toBe(false);
  });
});
