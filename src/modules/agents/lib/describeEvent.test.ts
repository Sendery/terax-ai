import { describe, expect, it } from "vitest";
import { describeAgentEvent, NOTIFICATION_LABEL } from "./describeEvent";

describe("describeAgentEvent", () => {
  it("says the agent is blocked on you, not merely that it stopped", () => {
    const d = describeAgentEvent({
      kind: "attention",
      agent: "claude",
      text: "Claude needs your permission to use Bash",
      tabTitle: "api",
    });

    expect(d.title).toBe("claude needs your input");
    expect(d.body).toBe("Claude needs your permission to use Bash");
  });

  it("calls the end of a turn a turn, not the end of the work", () => {
    // Claude's Stop hook fires every turn, so calling this "finished" told the
    // user the agent was done when it was only handing the turn back.
    const d = describeAgentEvent({
      kind: "turn-end",
      agent: "claude",
      text: "Updated 3 files and ran the tests",
      tabTitle: "api",
    });

    expect(d.title).toBe("claude finished its turn");
    expect(d.body).toBe("Updated 3 files and ran the tests");
  });

  it("reports the agent itself ending separately from a turn", () => {
    const d = describeAgentEvent({
      kind: "exited",
      agent: "pi",
      tabTitle: "api",
    });

    expect(d.title).toBe("pi exited");
  });

  it("falls back to the tab when the agent said nothing", () => {
    const d = describeAgentEvent({
      kind: "turn-end",
      agent: "pi",
      tabTitle: "api",
    });

    expect(d.body).toBe("api");
  });

  it("has something to say even with no tab title", () => {
    const d = describeAgentEvent({
      kind: "turn-end",
      agent: "pi",
      tabTitle: "",
    });

    expect(d.body).toBe("pi");
  });

  it("collapses whitespace so a wrapped message stays one line", () => {
    const d = describeAgentEvent({
      kind: "attention",
      agent: "pi",
      text: "  pick   a\nbranch  ",
      tabTitle: "api",
    });

    expect(d.body).toBe("pick a branch");
  });

  it("shortens a message that would overrun the notification", () => {
    const d = describeAgentEvent({
      kind: "attention",
      agent: "pi",
      text: "x".repeat(200),
      tabTitle: "api",
    });

    expect(d.body.length).toBeLessThanOrEqual(120);
    expect(d.body.endsWith("…")).toBe(true);
  });

  it("labels every kind for the bell", () => {
    expect(Object.keys(NOTIFICATION_LABEL).sort()).toEqual([
      "attention",
      "error",
      "exited",
      "turn-end",
    ]);
    expect(NOTIFICATION_LABEL["turn-end"]).toBe("turn ended");
    expect(NOTIFICATION_LABEL.attention).toBe("needs input");
  });
});
