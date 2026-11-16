import { BUILTIN_AGENTS } from "@/modules/ai/lib/agents";
import { hydrateTabs, serializeTabs } from "@/modules/spaces/lib/serialize";
import type { GraphTab } from "@/modules/tabs";
import { describe, expect, it } from "vitest";
import { parseGraphSource, placeGraph, replaceGraph } from "./document";

const source = JSON.stringify({
  title: "System",
  nodes: [
    { id: "a", label: "A", shape: "decision" },
    { id: "b", label: "B", parent: "a" },
  ],
  edges: [{ id: "e", from: "a", to: "b" }],
  flows: [
    {
      id: "f",
      title: "Flow",
      participants: ["a", "b"],
      messages: [{ id: "m", from: "a", to: "b", label: "Call", kind: "sync" }],
    },
  ],
});
const tab = (): GraphTab => ({
  id: 9,
  kind: "graphx",
  spaceId: "s",
  title: "System",
  graphId: "system",
  documentId: "00000000-0000-4000-8000-000000000001",
  source,
  revision: 1,
  placement: "right",
});

describe("GraphX documents", () => {
  it("keeps useful hierarchy, shapes and sequences", () => {
    expect(parseGraphSource(source).nodes[0].shape).toBe("decision");
  });
  it("rejects executable markup, unknown fields and network data", () => {
    for (const extra of [
      { details_html: "<img onerror=alert(1)>" },
      { links: { url: "https://example.com" } },
      { __bad: "x" },
    ]) {
      expect(() =>
        parseGraphSource(
          JSON.stringify({
            nodes: [{ id: "a", label: "A", ...extra }],
            edges: [],
          }),
        ),
      ).toThrow();
    }
  });
  it("rejects duplicate ids, cycles, missing endpoints and oversized documents", () => {
    for (const value of [
      {
        nodes: [
          { id: "a", label: "A" },
          { id: "a", label: "B" },
        ],
        edges: [],
      },
      {
        nodes: [
          { id: "a", label: "A", parent: "b" },
          { id: "b", label: "B", parent: "a" },
        ],
        edges: [],
      },
      {
        nodes: [{ id: "a", label: "A" }],
        edges: [{ id: "e", from: "a", to: "missing" }],
      },
      { nodes: [{ id: "a", label: "A" }], edges: [], title: "x".repeat(50000) },
    ])
      expect(() => parseGraphSource(JSON.stringify(value))).toThrow();
  });
  it("updates one stable graph and rejects stale writers without mutation", () => {
    const tabs = [tab()];
    const next = replaceGraph(
      tabs,
      "system",
      "00000000-0000-4000-8000-000000000001",
      1,
      source,
    );
    expect(next[0]).toMatchObject({
      id: 9,
      graphId: "system",
      documentId: "00000000-0000-4000-8000-000000000001",
      revision: 2,
      placement: "right",
    });
    expect(() =>
      replaceGraph(
        next,
        "system",
        "00000000-0000-4000-8000-000000000001",
        1,
        source,
      ),
    ).toThrow(/revision/i);
    expect((next[0] as GraphTab).revision).toBe(2);
    expect(() =>
      replaceGraph(
        next,
        "system",
        "00000000-0000-4000-8000-000000000002",
        2,
        source,
      ),
    ).toThrow(/replaced/);

    expect(() =>
      replaceGraph(
        next,
        "missing",
        "00000000-0000-4000-8000-000000000001",
        2,
        source,
      ),
    ).toThrow(/not found/i);
  });
  it("docks one graph per space and keeps other spaces alone", () => {
    const tabs = [
      tab(),
      { ...tab(), id: 10, graphId: "other" },
      { ...tab(), id: 11, spaceId: "other-space", graphId: "third" },
    ];
    expect(
      placeGraph(tabs, "other", "left").map((t) => (t as GraphTab).placement),
    ).toEqual(["tab", "left", "right"]);
  });
  it("restores stable identity, source, revision and placement through spaces", () => {
    let id = 100;
    const out = hydrateTabs(serializeTabs([tab()]), "restored", () => id++);
    expect(out[0]).toMatchObject({
      kind: "graphx",
      graphId: "system",
      documentId: "00000000-0000-4000-8000-000000000001",
      source,
      revision: 1,
      placement: "right",
      cold: true,
    });
    const raw = serializeTabs([tab()]);
    expect(
      hydrateTabs([{ ...raw[0], source: "{}" }] as typeof raw, "s", () => id++),
    ).toEqual([]);
  });
  it("offers the exact manager persona with actual tool and customization instructions", () => {
    const agent = BUILTIN_AGENTS.find((a) => a.name === "Pi-Terax Agente");
    expect(agent?.instructions).toContain("terax_app_command");
    expect(agent?.instructions).toContain("app.commands");
    expect(agent?.instructions).toContain(".terax/pi-terax-commands.json");
  });
});
