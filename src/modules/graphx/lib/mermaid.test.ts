import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createContext, runInContext } from "node:vm";
import { describe, expect, it } from "vitest";
import {
  graphxDrawsMermaid,
  mermaidDiagramType,
  mermaidHeader,
} from "./mermaid";

// The real bundled engine and the real frame adapter run in a bare VM context. Only
// GraphX.mount and injectCSS are replaced, so the converter and the frame's own
// Mermaid handling (bounds, link and HTML stripping, error replies) are what is tested.
type Spec = {
  title: string;
  direction?: string;
  graphTab?: boolean;
  layout?: Record<string, unknown>;
  statuses?: Record<string, unknown>;
  lanes?: { id: string; label: string }[];
  nodes: Record<string, unknown>[];
  edges: Record<string, unknown>[];
  flows?: {
    participants: string[];
    messages: Record<string, unknown>[];
  }[];
};
type Reply = Record<string, unknown> & { type: string };
type Frame = {
  render: (mermaid: string, title?: string) => Promise<{
    spec: Spec | null;
    replies: Reply[];
  }>;
  engine: {
    fromMermaid: (text: string, options?: object) => {
      spec: Spec;
      warnings: string[];
    };
    mermaidTypes: string[];
  };
};

const root = resolve(__dirname, "../../../..");
const engineSource = readFileSync(
  resolve(root, "public/graphx/engine.js"),
  "utf8",
);
const frameSource = readFileSync(
  resolve(root, "public/graphx/frame.js"),
  "utf8",
);

function stubElement() {
  return {
    hidden: false,
    textContent: "",
    style: { setProperty() {} },
    dataset: {} as Record<string, string>,
    querySelectorAll: () => [],
    querySelector: () => null,
    matches: () => false,
    addEventListener() {},
  };
}

function loadFrame(): Frame {
  const listeners = new Map<string, (event: unknown) => unknown>();
  let replies: Reply[] = [];
  let mounted: Spec | null = null;
  const host = stubElement();
  const status = stubElement();
  const documentStub = {
    ...stubElement(),
    documentElement: stubElement(),
    body: stubElement(),
    head: stubElement(),
    getElementById: (id: string) => (id === "graph" ? host : status),
    createElement: () => stubElement(),
  };
  const parent = {
    postMessage: (message: Reply) => {
      replies.push(message);
    },
  };
  const context: Record<string, unknown> = {
    console: { warn() {}, error() {}, log() {}, info() {} },
    document: documentStub,
    location: { hash: "#token" },
    parent,
    innerHeight: 600,
    innerWidth: 800,
    setTimeout,
    clearTimeout,
    getComputedStyle: () => ({}),
    ResizeObserver: class {
      observe() {}
    },
    addEventListener: (type: string, listener: (event: unknown) => unknown) =>
      listeners.set(type, listener),
  };
  context.globalThis = context;
  context.self = context;
  context.window = context;
  createContext(context);
  runInContext(engineSource, context);
  const engine = context.GraphX as Frame["engine"] & {
    mount: unknown;
    injectCSS: unknown;
  };
  engine.injectCSS = () => {};
  engine.mount = (_host: unknown, spec: Spec) => {
    mounted = JSON.parse(JSON.stringify(spec));
    return { ready: Promise.resolve(), destroy() {} };
  };
  let revision = 0;
  return {
    engine,
    async render(mermaid: string, title?: string) {
      // A frame renders once, so every call evaluates a fresh adapter over the same engine.
      replies = [];
      mounted = null;
      runInContext(frameSource, context);
      const listener = listeners.get("message");
      if (!listener) throw new Error("frame did not listen for messages");
      await listener({
        source: parent,
        data: {
          type: "terax:graphx:render",
          token: "token",
          mermaid,
          title,
          documentId: "mermaid-test",
          revision: ++revision,
          theme: "light",
        },
      });
      return { spec: mounted, replies };
    },
  };
}

let shared: Frame | null = null;
async function convert(mermaid: string, title?: string) {
  shared ??= loadFrame();
  return shared.render(mermaid, title);
}

async function spec(mermaid: string): Promise<Spec> {
  const result = await convert(mermaid);
  if (!result.spec)
    throw new Error(`not mounted: ${JSON.stringify(result.replies)}`);
  return result.spec;
}

const node = (s: Spec, id: string) =>
  s.nodes.find((n) => n.id === id) ?? ({} as Record<string, unknown>);
const edge = (s: Spec, from: string, to: string) =>
  s.edges.find((e) => e.from === from && e.to === to) ??
  ({} as Record<string, unknown>);

describe("Mermaid routing", () => {
  it("finds the diagram keyword past frontmatter, directives and comments", () => {
    const source = [
      "---",
      "title: Orders",
      "---",
      "%%{init: {'theme': 'dark'}}%%",
      "%% a comment",
      "accTitle: Orders",
      "accDescr {",
      "  long text",
      "}",
      "flowchart LR",
      "  A --> B",
    ].join("\n");
    expect(mermaidHeader(source)).toBe("flowchart LR");
    expect(mermaidDiagramType(source)).toBe("flowchart");
    expect(mermaidDiagramType("pie title Pets")).toBe("pie");
    expect(mermaidDiagramType("  \n%% only a comment\n")).toBeNull();
  });

  it("sends graph diagrams to GraphX and data charts to the Mermaid fallback", () => {
    for (const source of [
      "graph TD\nA-->B",
      "flowchart LR\nA-->B",
      "sequenceDiagram\nA->>B: hi",
      "classDiagram\nA <|-- B",
      "stateDiagram-v2\n[*] --> A",
      "erDiagram\nA ||--o{ B : has",
      "mindmap\n  root",
      "gantt\n  title x",
      "journey\n  title x",
      "timeline\n  title x",
      "gitGraph\n  commit",
      "C4Context\n  Person(a, \"A\")",
      "architecture-beta\n  service a(server)[A]",
      "block-beta\n  a b",
      "requirementDiagram\n  element a {\n  }",
      "sankey-beta\nA,B,1",
      "kanban\n  todo[Todo]",
      "treemap-beta\n\"A\"",
    ])
      expect(graphxDrawsMermaid(source), source).toBe(true);
    for (const source of [
      "pie title Pets\n\"Dogs\" : 1",
      "quadrantChart\n  title x",
      "xychart-beta\n  x-axis [a]",
      "radar-beta\n  axis a",
      "packet-beta\n  0-15: \"Port\"",
      "venn-beta\n  set A",
      "zenuml\n  A.b()",
      "info",
      "",
    ])
      expect(graphxDrawsMermaid(source), source).toBe(false);
  });
});

describe("GraphX Mermaid conversion in the frame", () => {
  it("routes exactly the types the bundled converter reads", () => {
    shared ??= loadFrame();
    expect([...shared.engine.mermaidTypes].sort()).toEqual(
      [
        "C4",
        "architecture",
        "block",
        "classDiagram",
        "erDiagram",
        "flowchart",
        "gantt",
        "gitGraph",
        "journey",
        "kanban",
        "mindmap",
        "requirementDiagram",
        "sankey",
        "sequenceDiagram",
        "stateDiagram",
        "timeline",
        "treemap",
      ].sort(),
    );
  });

  it("flowchart: shapes, subgraphs, edge text and styles; links dropped", async () => {
    const s = await spec(
      [
        "flowchart LR",
        "  client([Client]) -->|places order| web[Web shop]",
        "  subgraph backend [Backend]",
        "    api{{Orders API}} --> check{In stock?}",
        "    check -- Yes --> reserve[[Reserve]]",
        "    check -- No --> notify>Notify]",
        "    reserve ==> pay[/Card payment/]",
        "    db[(Postgres)]",
        "  end",
        "  reserve --> db",
        "  api -.-> cache((Redis))",
        "  notify --x client",
        "  classDef hot fill:#fdd,stroke:#c00",
        "  class check hot",
        '  click web "https://example.com/shop" "Shop"',
      ].join("\n"),
    );
    expect(s.direction).toBe("right");
    expect(node(s, "check").shape).toBe("decision");
    expect(node(s, "db").shape).toBe("datastore");
    expect(node(s, "reserve").shape).toBe("subroutine");
    expect(node(s, "client").shape).toBe("terminal");
    expect(node(s, "cache").shape).toBe("circle");
    expect(node(s, "db").parent).toBe("backend");
    expect(edge(s, "client", "web").label).toBe("places order");
    expect(edge(s, "check", "reserve").label).toBe("Yes");
    expect(edge(s, "api", "cache").kind).toBe("async");
    expect(edge(s, "reserve", "pay").emphasis).toBe("hero");
    expect(edge(s, "notify", "client").head).toBe("cross");
    expect(node(s, "check").color).toBeTruthy();
    expect(s.nodes.some((n) => "links" in n || "details_html" in n)).toBe(
      false,
    );
  });

  it("sequence: participants, messages, blocks, notes and activations", async () => {
    const s = await spec(
      [
        "sequenceDiagram",
        "  actor U as User",
        "  participant W as Web",
        "  participant A as API",
        "  U->>W: Sign in",
        "  W->>+A: GET /login",
        "  A-->>-W: 302",
        "  Note right of W: follows the redirect",
        "  alt valid",
        "    A->>A: validate",
        "  else invalid",
        "    A--xW: error",
        "  end",
        "  loop every claim",
        "    W-)A: ping",
        "  end",
      ].join("\n"),
    );
    expect(s.graphTab).toBe(false);
    const flow = s.flows?.[0];
    expect(flow?.participants).toEqual(["U", "W", "A"]);
    const messages = flow?.messages ?? [];
    expect(node(s, "U").kind).toBe("actor");
    expect(messages.some((m) => m.kind === "self")).toBe(true);
    expect(messages.some((m) => m.kind === "return")).toBe(true);
    expect(messages.some((m) => m.kind === "note" && m.side === "right")).toBe(
      true,
    );
    expect(messages.filter((m) => m.kind === "block")).toHaveLength(2);
    expect(messages.filter((m) => m.kind === "else")).toHaveLength(1);
    expect(messages.some((m) => m.activate === "A")).toBe(true);
    expect(messages.some((m) => m.deactivate === "A")).toBe(true);
    expect(messages.some((m) => m.head === "cross")).toBe(true);
  });

  it("class: UML rows, relationship ends and cardinalities; member HTML dropped", async () => {
    const s = await spec(
      [
        "classDiagram",
        "  class Animal {",
        "    <<abstract>>",
        "    +String name",
        "    +makeSound()* void",
        "  }",
        "  Animal <|-- Dog",
        '  Dog "1" *-- "0..1" Collar : wears',
        "  Dog ..> Bone : uses",
      ].join("\n"),
    );
    const animal = node(s, "Animal");
    expect(animal.shape).toBe("class");
    expect(animal.subtitle).toBe("«abstract»");
    expect(
      (animal.rows as { name: string; section?: string }[]).some(
        (r) => r.section === "method" && r.name === "makeSound()",
      ),
    ).toBe(true);
    expect(animal.details_html).toBeUndefined();
    expect(edge(s, "Animal", "Dog").tail).toBe("triangle");
    expect(edge(s, "Dog", "Collar").tail).toBe("diamond");
    expect(edge(s, "Dog", "Collar").tailLabel).toBe("1");
    expect(edge(s, "Dog", "Collar").headLabel).toBe("0..1");
    expect(edge(s, "Dog", "Bone").kind).toBe("async");
  });

  it("state: start and end, composite states, choice and notes", async () => {
    const s = await spec(
      [
        "stateDiagram-v2",
        "  [*] --> Draft",
        '  state "In review" as Review',
        "  Draft --> Review : submit",
        "  state Approved {",
        "    [*] --> Scheduled",
        "    Scheduled --> [*]",
        "  }",
        "  Review --> Approved",
        "  state decide <<choice>>",
        "  Approved --> decide",
        "  decide --> [*]",
        "  note right of Review : someone else checks",
      ].join("\n"),
    );
    expect(node(s, "start").kind).toBe("start");
    expect(node(s, "end").kind).toBe("end");
    expect(node(s, "Review").label).toBe("In review");
    expect(node(s, "Scheduled").parent).toBe("Approved");
    expect(node(s, "decide").kind).toBe("choice");
    expect(s.nodes.some((n) => n.shape === "note")).toBe(true);
  });

  it("ER: entities as tables with keys and crow's foot ends", async () => {
    const s = await spec(
      [
        "erDiagram",
        "  CUSTOMER ||--o{ ORDER : places",
        "  CUSTOMER }|..|{ DELIVERY-ADDRESS : uses",
        "  CUSTOMER {",
        "    string id PK",
        "    string email UK",
        "  }",
      ].join("\n"),
    );
    const customer = node(s, "CUSTOMER");
    expect(customer.shape).toBe("table");
    expect(
      (customer.rows as { name: string; keys?: string }[]).some(
        (r) => r.name === "id" && r.keys === "PK",
      ),
    ).toBe(true);
    expect(edge(s, "CUSTOMER", "ORDER").tail).toBe("one");
    expect(edge(s, "CUSTOMER", "ORDER").head).toBe("zero-many");
    expect(edge(s, "CUSTOMER", "DELIVERY-ADDRESS").kind).toBe("async");
  });

  it("gantt: a date axis, task bars, dependencies, statuses and milestones", async () => {
    const s = await spec(
      [
        "gantt",
        "  title Launch",
        "  dateFormat YYYY-MM-DD",
        "  excludes weekends",
        "  section Design",
        "  Research :done, des1, 2026-09-01, 5d",
        "  Prototype :active, des2, after des1, 7d",
        "  section Build",
        "  Backend :crit, dev1, after des2, 10d",
        "  Frontend :dev2, after des2, 8d",
        "  Integration :dev3, after dev1 dev2, 3d",
        "  Beta :milestone, m1, after dev3, 0d",
      ].join("\n"),
    );
    expect(s.layout?.mode).toBe("gantt");
    expect(s.layout?.weekends).toBe(true);
    const research = s.nodes.find((n) => n.label === "Research");
    expect(research?.span).toMatchObject({
      start: "2026-09-01",
      end: "2026-09-08",
    });
    const integration = s.nodes.find((n) => n.label === "Integration");
    expect(s.edges.filter((e) => e.to === integration?.id)).toHaveLength(2);
    expect(Object.keys(s.statuses ?? {})).toEqual(
      expect.arrayContaining(["done", "active", "crit"]),
    );
    expect(s.nodes.some((n) => n.kind === "milestone")).toBe(true);
  });

  it("mindmap, timeline and journey become trees, periods and scored steps", async () => {
    const mind = await spec(
      "mindmap\n  root((Topic))\n    A\n      A1\n      A2\n    B)Cloud(",
    );
    expect(mind.nodes).toHaveLength(5);
    expect(mind.edges).toHaveLength(4);
    expect(node(mind, "root").kind).toBe("circle");
    const timeline = await spec(
      "timeline\n  title History\n  2004 : Facebook : Gmail\n  2006 : Twitter\n       : Spotify",
    );
    expect(timeline.layout?.mode).toBe("timeline");
    expect(timeline.nodes.filter((n) => n.kind === "event")).toHaveLength(4);
    const journey = await spec(
      "journey\n  title Day\n  section Commute\n    Coffee: 5: Me\n    Train: 2: Me, Neighbour\n  section Work\n    Code: 4: Me",
    );
    expect(journey.layout?.mode).toBe("journey");
    expect(journey.nodes.filter((n) => n.kind === "job")).toHaveLength(3);
  });

  it("gitGraph, C4, architecture, block, requirement, sankey, kanban and treemap convert", async () => {
    const git = await spec(
      'gitGraph\n  commit id: "init"\n  branch develop\n  checkout develop\n  commit id: "a" tag: "v0.1"\n  checkout main\n  merge develop',
    );
    expect(git.lanes?.map((l) => l.label)).toEqual(["main", "develop"]);
    expect(git.edges.some((e) => e.label === "merge")).toBe(true);
    const c4 = await spec(
      'C4Context\n  Person(customer, "Customer")\n  System_Boundary(b0, "Bank") {\n    SystemDb(db, "Mainframe")\n  }\n  Rel(customer, db, "Reads")',
    );
    expect(node(c4, "customer").shape).toBe("person");
    expect(node(c4, "db").parent).toBe("b0");
    const arch = await spec(
      "architecture-beta\n  group api(cloud)[API]\n  service db(database)[DB] in api\n  service server(server)[Server] in api\n  db:L -- R:server",
    );
    expect(node(arch, "db").parent).toBe("api");
    const block = await spec(
      'block-beta\n  columns 3\n  a["In"] b c\n  a --> b',
    );
    expect(block.layout?.mode).toBe("grid");
    const req = await spec(
      "requirementDiagram\n  requirement r1 {\n  id: 1\n  text: Fast.\n  risk: high\n  verifymethod: test\n  }\n  element e1 {\n  type: simulation\n  }\n  e1 - satisfies -> r1",
    );
    expect(node(req, "r1").status).toBe("risk-high");
    const sankey = await spec("sankey-beta\nSolar,Grid,60\nGrid,Homes,50");
    expect(sankey.layout?.mode).toBe("sankey");
    expect(sankey.edges.every((e) => typeof e.weight === "number")).toBe(true);
    const kanban = await spec(
      "kanban\n  todo[Todo]\n    t1[Design]\n  done[Done]\n    t2[Ship]",
    );
    expect(kanban.lanes).toHaveLength(2);
    const treemap = await spec(
      'treemap-beta\n"Budget"\n    "Ops": 700\n    "Ads": 400',
    );
    expect(treemap.layout?.mode).toBe("treemap");
  });

  it("refuses data charts and ZenUML with a reason the parent can show", async () => {
    for (const [source, reason] of [
      ['pie title Pets\n  "Dogs" : 386', /data chart/],
      ["xychart-beta\n  x-axis [a, b]", /data chart/],
      ["quadrantChart\n  title Reach", /data chart/],
      ["zenuml\n  A.b()", /ZenUML/],
      ["info", /unrecognised Mermaid diagram type/],
    ] as const) {
      const { spec: mounted, replies } = await convert(source);
      expect(mounted, source).toBeNull();
      const error = replies.find((r) => r.type === "terax:graphx:error");
      expect(error?.reason, source).toBe("mermaid");
      expect(String(error?.message), source).toMatch(reason);
    }
  });

  it("bounds the source and reports converter warnings with the render", async () => {
    const { spec: big, replies } = await convert(
      `flowchart LR\n${"A-->B\n".repeat(9000)}`,
    );
    expect(big).toBeNull();
    expect(replies.find((r) => r.type === "terax:graphx:error")?.reason).toBe(
      "mermaid",
    );
    const titled = await convert("flowchart LR\n  A --> B", "Order flow");
    expect(titled.spec?.title).toBe("Order flow");
    const warned = await convert("flowchart LR\n  A --> B\n  ??? nothing");
    expect(warned.spec?.nodes).toHaveLength(2);
  });
});
