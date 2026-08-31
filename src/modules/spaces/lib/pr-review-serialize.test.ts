import type { PrReviewTab, Tab } from "@/modules/tabs";
import { describe, expect, it } from "vitest";
import { hydrateTabs, serializeTabs } from "./serialize";

const review = (over: Partial<PrReviewTab> = {}): Tab =>
  ({
    id: 1,
    kind: "pr-review",
    spaceId: "default",
    title: "Review feature/x",
    repoRoot: "/repo",
    head: "feature/x",
    base: "origin/main",
    ...over,
  }) as Tab;

function roundTrip(tabs: Tab[]): Tab[] {
  let next = 100;
  return hydrateTabs(serializeTabs(tabs), "default", () => next++);
}

describe("pr-review tabs in a space", () => {
  it("survives a restart with the branches it was reviewing", () => {
    const [restored] = roundTrip([review()]);

    expect(restored).toMatchObject({
      kind: "pr-review",
      repoRoot: "/repo",
      head: "feature/x",
      base: "origin/main",
    });
  });

  it("comes back cold so the review is not rebuilt until it is opened", () => {
    expect(roundTrip([review()])[0]).toMatchObject({ cold: true });
  });

  it("keeps the tab colour", () => {
    expect(roundTrip([review({ color: "purple" })])[0]).toMatchObject({
      color: "purple",
    });
  });

  it("drops a stored review whose branch names are unusable", () => {
    // Branch names reach git as arguments, so a stored name that would be read
    // as an option is discarded rather than replayed after a restart.
    const stored = serializeTabs([review()]).map((t) => ({
      ...t,
      head: "--upload-pack=x",
    }));

    expect(hydrateTabs(stored, "default", () => 1)).toEqual([]);
  });

  it("drops a stored review with no repository", () => {
    const stored = serializeTabs([review()]).map((t) => ({
      ...t,
      repoRoot: "",
    }));

    expect(hydrateTabs(stored, "default", () => 1)).toEqual([]);
  });
});
