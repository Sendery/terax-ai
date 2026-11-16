import type { GraphTab, Tab } from "@/modules/tabs";
import { z } from "zod";

export const MAX_GRAPH_BYTES = 48 * 1024;
export const GRAPH_PLACEMENTS = ["tab", "left", "right", "floating"] as const;
export type GraphPlacement = (typeof GRAPH_PLACEMENTS)[number];
export const graphDocumentIdSchema = z.uuid();
export const graphIdSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/);
const id = graphIdSchema;
const text = z.string().max(4000);
const label = z.string().max(160);
const color = z.string().regex(/^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?$/);
const delta = z.enum(["added", "modified", "removed", "unchanged"]);
const arrow = z.enum([
  "arrow",
  "none",
  "triangle",
  "diamond",
  "odiamond",
  "circle",
  "cross",
  "open",
  "lollipop",
  "one",
  "zero-one",
  "one-many",
  "zero-many",
  "line",
]);
const node = z.strictObject({
  id,
  label,
  kind: label.optional(),
  summary: text.optional(),
  subtitle: label.optional(),
  parent: id.optional(),
  lane: id.optional(),
  tags: z.array(label).max(20).optional(),
  delta: delta.optional(),
  color: color.optional(),
  fill: color.optional(),
  textColor: color.optional(),
  shape: z
    .enum([
      "rect",
      "rounded",
      "terminal",
      "subroutine",
      "datastore",
      "cylinder-h",
      "circle",
      "dcircle",
      "hexagon",
      "decision",
      "io",
      "io-l",
      "trapezoid",
      "trapezoid-t",
      "flag",
      "document",
      "cloud",
      "bang",
      "triangle",
      "triangle-down",
      "hourglass",
      "delay",
      "card",
      "text",
      "arrow-right",
      "arrow-left",
      "arrow-up",
      "arrow-down",
      "note",
      "start",
      "end",
      "junction",
      "choice",
      "fork",
      "commit",
      "table",
      "class",
      "requirement",
      "tile",
      "actor",
      "person",
      "c4",
      "bar",
      "score",
      "ticket",
      "flowbar",
      "block",
      "gbar",
      "sbar",
      "commit-merge",
      "commit-highlight",
      "commit-reverse",
      "c4-db",
      "c4-queue",
    ])
    .optional(),
  rows: z
    .array(
      z.strictObject({
        name: label,
        type: label.optional(),
        comment: label.optional(),
        keys: label.optional(),
        vis: label.optional(),
        section: label.optional(),
      }),
    )
    .max(40)
    .optional(),
  span: z
    .strictObject({
      start: label,
      end: label,
      milestone: z.boolean().optional(),
      live: z.boolean().optional(),
    })
    .optional(),
  score: z.number().finite().min(-1000).max(1000).optional(),
  value: z.union([label, z.number().finite().min(-1e9).max(1e9)]).optional(),
  badge: label.optional(),
  avatar: label.optional(),
  head: label.optional(),
  frame: z.enum(["dashed", "dotted"]).optional(),
  notes: z
    .array(z.strictObject({ tone: z.enum(["warn", "info", "good"]), text }))
    .max(20)
    .optional(),
  metrics: z
    .array(z.strictObject({ label, value: label }))
    .max(20)
    .optional(),
});
const edge = z.strictObject({
  id,
  from: id,
  to: id,
  kind: label.optional(),
  label: label.optional(),
  summary: text.optional(),
  data: text.optional(),
  trigger: text.optional(),
  animated: z.boolean().optional(),
  emphasis: z.enum(["hero", "normal", "muted"]).optional(),
  delta: delta.optional(),
  color: color.optional(),
  head: arrow.optional(),
  tail: arrow.optional(),
  headLabel: label.optional(),
  tailLabel: label.optional(),
  weight: z.number().finite().min(0).max(1000).optional(),
  curve: z.boolean().optional(),
});
const message = z.strictObject({
  id,
  from: id.optional(),
  to: id.optional(),
  label: label.optional(),
  kind: z
    .enum([
      "sync",
      "async",
      "return",
      "self",
      "phase",
      "block",
      "else",
      "end",
      "note",
      "activate",
      "deactivate",
      "create",
      "destroy",
    ])
    .optional(),
  block: label.optional(),
  title: label.optional(),
  over: z.array(id).max(20).optional(),
  side: z.enum(["over", "left", "right"]).optional(),
  node: id.optional(),
  head: arrow.optional(),
  tail: arrow.optional(),
  activate: id.optional(),
  deactivate: id.optional(),
  summary: text.optional(),
  data: text.optional(),
  note: text.optional(),
  repeat: label.optional(),
  animated: z.boolean().optional(),
  color: color.optional(),
});
const graphSchema = z.strictObject({
  title: z.string().min(1).max(80).default("GraphX diagram"),
  lang: z.enum(["es", "en"]).optional(),
  direction: z.enum(["right", "down"]).optional(),
  nodes: z.array(node).min(1).max(160),
  edges: z.array(edge).max(500).default([]),
  lanes: z
    .array(
      z.strictObject({
        id,
        label,
        subtitle: label.optional(),
        color: color.optional(),
      }),
    )
    .max(30)
    .optional(),
  levels: z
    .array(z.strictObject({ depth: z.number().int().min(0).max(16), label }))
    .max(17)
    .optional(),
  initialDepth: z.number().int().min(0).max(16).optional(),
  collapsed: z.array(id).max(160).optional(),
  initialView: label.optional(),
  graphTab: z.boolean().optional(),
  layout: z
    .strictObject({
      lanes: z.enum(["strict", "flow"]).optional(),
      frames: z.boolean().optional(),
      cycles: z.enum(["dfs", "order"]).optional(),
      backEdges: z.literal("route").optional(),
    })
    .optional(),
  flows: z
    .array(
      z.strictObject({
        id,
        title: label,
        summary: text.optional(),
        participants: z.array(id).max(50),
        messages: z.array(message).max(160),
      }),
    )
    .max(12)
    .optional(),
  tour: z
    .strictObject({
      title: label,
      steps: z
        .array(
          z.strictObject({
            title: label,
            body: text.optional(),
            view: label.optional(),
            depth: z.number().int().min(0).max(16).optional(),
            focus: z
              .strictObject({
                nodes: z.array(id).max(160).optional(),
                edges: z.array(id).max(500).optional(),
                messages: z.array(id).max(160).optional(),
              })
              .optional(),
            expand: z.array(id).max(160).optional(),
            collapse: z.array(id).max(160).optional(),
            select: id.optional(),
          }),
        )
        .max(40),
    })
    .optional(),
});
export type GraphSpec = z.infer<typeof graphSchema>;
export function parseGraphSource(source: string): GraphSpec {
  if (
    typeof source !== "string" ||
    source.length > MAX_GRAPH_BYTES ||
    new TextEncoder().encode(source).length > MAX_GRAPH_BYTES
  )
    throw new Error("GraphX source exceeds 48 KiB");
  const parsed = graphSchema.safeParse(JSON.parse(source));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`Invalid GraphX ${issue.path.join(".")}: ${issue.message}`);
  }
  const graph = parsed.data;
  const unique = (items: { id: string }[]) => {
    const set = new Set(items.map((n) => n.id));
    if (set.size !== items.length) throw new Error("Duplicate GraphX ids");
    return set;
  };
  const nodes = unique(graph.nodes),
    edges = unique(graph.edges),
    lanes = unique(graph.lanes ?? []),
    flows = unique(graph.flows ?? []);
  const requireIds = (ids: string[], set = nodes) => {
    for (const key of ids)
      if (!set.has(key)) throw new Error(`Unknown GraphX reference: ${key}`);
  };
  const parents = new Map(graph.nodes.map((n) => [n.id, n.parent]));
  for (const n of graph.nodes) {
    if (n.lane) requireIds([n.lane], lanes);
    const seen = new Set([n.id]);
    let parent = n.parent;
    while (parent) {
      requireIds([parent]);
      if (seen.has(parent)) throw new Error("GraphX parent cycle");
      seen.add(parent);
      if (seen.size > 17) throw new Error("GraphX hierarchy exceeds 16 levels");
      parent = parents.get(parent);
    }
  }
  for (const e of graph.edges) requireIds([e.from, e.to]);
  const messages = new Set<string>();
  for (const f of graph.flows ?? []) {
    requireIds(f.participants);
    unique(f.messages);
    for (const m of f.messages) {
      if (messages.has(m.id)) throw new Error("Duplicate GraphX message id");
      messages.add(m.id);
      const references = [
        m.from,
        m.to,
        m.node,
        m.activate,
        m.deactivate,
        ...(m.over ?? []),
      ].filter((x): x is string => !!x);
      requireIds(references, new Set(f.participants));
      if (
        ["sync", "async", "return", "self"].includes(m.kind ?? "sync") &&
        (!m.from || !m.to)
      )
        throw new Error("GraphX message requires from and to");
      if (m.kind === "self" && m.from !== m.to)
        throw new Error("GraphX self message must use the same node");
    }
  }
  const checkView = (view: string | undefined) => {
    if (
      view &&
      view !== "graph" &&
      !(view.startsWith("flow:") && flows.has(view.slice(5)))
    )
      throw new Error("Unknown GraphX view");
  };
  checkView(graph.initialView);
  requireIds(graph.collapsed ?? []);
  for (const step of graph.tour?.steps ?? []) {
    checkView(step.view);
    requireIds([
      ...(step.expand ?? []),
      ...(step.collapse ?? []),
      ...(step.select ? [step.select] : []),
      ...(step.focus?.nodes ?? []),
    ]);
    requireIds(step.focus?.edges ?? [], edges);
    requireIds(step.focus?.messages ?? [], messages);
  }
  return graph;
}
export function findGraph(tabs: readonly Tab[], graphId: string): GraphTab {
  const matches = tabs.filter(
    (t): t is GraphTab => t.kind === "graphx" && t.graphId === graphId,
  );
  if (matches.length > 1)
    throw new Error(
      "Ambiguous GraphX id; rename or close the duplicate document",
    );
  const tab = matches[0];
  if (!tab) throw new Error(`GraphX document not found: ${graphId}`);
  return tab;
}
export function replaceGraph(
  tabs: readonly Tab[],
  graphId: string,
  documentId: string,
  expectedRevision: number,
  source: string,
): Tab[] {
  const tab = findGraph(tabs, graphId);
  if (tab.documentId !== documentId)
    throw new Error(
      "GraphX document was replaced; read it again before updating",
    );
  if (tab.revision !== expectedRevision)
    throw new Error(
      "GraphX revision conflict; read the current document before updating",
    );
  const spec = parseGraphSource(source);
  if (tab.revision >= Number.MAX_SAFE_INTEGER)
    throw new Error("GraphX revision exhausted");
  return tabs.map((t) =>
    t === tab
      ? { ...tab, source, title: spec.title, revision: tab.revision + 1 }
      : t,
  );
}
export function placeGraph(
  tabs: readonly Tab[],
  graphId: string,
  placement: GraphPlacement,
): Tab[] {
  const tab = findGraph(tabs, graphId);
  if (!GRAPH_PLACEMENTS.includes(placement))
    throw new Error("Invalid GraphX placement");
  return tabs.map((t) =>
    t.kind !== "graphx"
      ? t
      : t === tab
        ? { ...t, placement }
        : t.spaceId === tab.spaceId && placement !== "tab"
          ? { ...t, placement: "tab" }
          : t,
  );
}
export const STARTER_GRAPH = JSON.stringify(
  {
    title: "Interactive system map",
    lang: "en",
    nodes: [
      {
        id: "interface",
        label: "Interface",
        kind: "ui",
        summary: "Explore this graph, then edit its JSON.",
      },
      {
        id: "agent",
        label: "Pi-Terax Agente",
        kind: "service",
        summary: "Discovers commands and updates this persistent document.",
      },
      {
        id: "storage",
        label: "Space storage",
        kind: "datastore",
        shape: "datastore",
        summary: "Graph source and panel placement survive restart.",
      },
    ],
    edges: [
      {
        id: "request",
        from: "interface",
        to: "agent",
        label: "Ask",
        animated: true,
      },
      { id: "save", from: "agent", to: "storage", label: "Update" },
    ],
    flows: [
      {
        id: "update",
        title: "Graph update",
        participants: ["interface", "agent", "storage"],
        messages: [
          {
            id: "ask",
            from: "interface",
            to: "agent",
            label: "Discover commands",
            kind: "sync",
          },
          {
            id: "write",
            from: "agent",
            to: "storage",
            label: "Update expected revision",
            kind: "sync",
          },
        ],
      },
    ],
  },
  null,
  2,
);
