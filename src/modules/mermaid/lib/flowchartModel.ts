export type FlowDirection = "TB" | "TD" | "BT" | "RL" | "LR";
export type FlowNodeShape =
  | "rectangle"
  | "rounded"
  | "stadium"
  | "circle"
  | "diamond"
  | "hexagon"
  | "database"
  | "subroutine";
export type FlowEdgeType = "arrow" | "open" | "dotted" | "thick";

export type FlowNode = {
  id: string;
  label: string;
  shape: FlowNodeShape;
};

export type FlowEdge = {
  id: string;
  from: string;
  to: string;
  label: string;
  type: FlowEdgeType;
};

export type FlowchartVisualModel = {
  kind: "flowchart";
  direction: FlowDirection;
  nodes: FlowNode[];
  edges: FlowEdge[];
};

export type FlowchartParseResult =
  | { ok: true; model: FlowchartVisualModel }
  | { ok: false; reason: string };

const FLOW_ID = /^[A-Za-z][A-Za-z0-9_-]*$/;
const FLOW_DIRECTIONS = new Set<FlowDirection>(["TB", "TD", "BT", "RL", "LR"]);
const EDGE_SYNTAX: Record<FlowEdgeType, string> = {
  arrow: "-->",
  open: "---",
  dotted: "-.->",
  thick: "==>",
};

function decodeLabel(raw: string): string | null {
  const value = raw.trim();
  const quoted = value.startsWith('"') && value.endsWith('"');
  const label = quoted
    ? value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\")
    : value;
  if (!label || /[<>\r\n]/.test(label)) return null;
  return label;
}

function assertId(id: string): void {
  if (!FLOW_ID.test(id)) throw new Error(`Invalid flowchart node id: ${id}`);
}

function assertLabel(label: string): void {
  if (!label.trim() || /[<>|\r\n]/.test(label)) {
    throw new Error("Flowchart labels must be plain single-line text");
  }
}

function parseNodeToken(token: string): {
  id: string;
  label: string;
  shape: FlowNodeShape;
  explicit: boolean;
} | null {
  const value = token.trim();
  const patterns: Array<[RegExp, FlowNodeShape]> = [
    [/^([A-Za-z][A-Za-z0-9_-]*)\(\[([\s\S]*)\]\)$/, "stadium"],
    [/^([A-Za-z][A-Za-z0-9_-]*)\(\(([\s\S]*)\)\)$/, "circle"],
    [/^([A-Za-z][A-Za-z0-9_-]*)\[\(([\s\S]*)\)\]$/, "database"],
    [/^([A-Za-z][A-Za-z0-9_-]*)\[\[([\s\S]*)\]\]$/, "subroutine"],
    [/^([A-Za-z][A-Za-z0-9_-]*)\{\{([\s\S]*)\}\}$/, "hexagon"],
    [/^([A-Za-z][A-Za-z0-9_-]*)\{([\s\S]*)\}$/, "diamond"],
    [/^([A-Za-z][A-Za-z0-9_-]*)\(([\s\S]*)\)$/, "rounded"],
    [/^([A-Za-z][A-Za-z0-9_-]*)\[([\s\S]*)\]$/, "rectangle"],
  ];
  for (const [pattern, shape] of patterns) {
    const match = value.match(pattern);
    if (!match) continue;
    const label = decodeLabel(match[2]);
    if (!label) return null;
    return { id: match[1], label, shape, explicit: true };
  }
  if (!FLOW_ID.test(value)) return null;
  return { id: value, label: value, shape: "rectangle", explicit: false };
}

function edgeTypeFromSyntax(syntax: string): FlowEdgeType | null {
  const entry = Object.entries(EDGE_SYNTAX).find(
    ([, value]) => value === syntax,
  );
  return (entry?.[0] as FlowEdgeType | undefined) ?? null;
}

function quoteLabel(label: string): string {
  return `"${label.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function serializeNode(node: FlowNode): string {
  const label = quoteLabel(node.label);
  switch (node.shape) {
    case "rectangle":
      return `${node.id}[${label}]`;
    case "rounded":
      return `${node.id}(${label})`;
    case "stadium":
      return `${node.id}([${label}])`;
    case "circle":
      return `${node.id}((${label}))`;
    case "diamond":
      return `${node.id}{${label}}`;
    case "hexagon":
      return `${node.id}{{${label}}}`;
    case "database":
      return `${node.id}[(${label})]`;
    case "subroutine":
      return `${node.id}[[${label}]]`;
  }
}

export function parseFlowchartVisualSource(
  source: string,
): FlowchartParseResult {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const first = lines.shift()?.trim() ?? "";
  const header = first.match(/^(?:flowchart|graph)\s+(TB|TD|BT|RL|LR)$/i);
  if (!header) {
    return { ok: false, reason: "Visual editing requires a flowchart header" };
  }
  const direction = header[1].toUpperCase() as FlowDirection;
  if (!FLOW_DIRECTIONS.has(direction)) {
    return { ok: false, reason: "Unsupported flowchart direction" };
  }

  const nodes: FlowNode[] = [];
  const nodeIndex = new Map<string, number>();
  const explicitNodes = new Set<string>();
  let duplicateExplicitNodeId: string | null = null;
  const edges: FlowEdge[] = [];

  const addNode = (
    parsed: NonNullable<ReturnType<typeof parseNodeToken>>,
  ): boolean => {
    const existingIndex = nodeIndex.get(parsed.id);
    if (existingIndex === undefined) {
      nodeIndex.set(parsed.id, nodes.length);
      nodes.push({ id: parsed.id, label: parsed.label, shape: parsed.shape });
      if (parsed.explicit) explicitNodes.add(parsed.id);
      return true;
    }
    if (!parsed.explicit) return true;
    if (explicitNodes.has(parsed.id)) {
      duplicateExplicitNodeId = parsed.id;
      return false;
    }
    nodes[existingIndex] = {
      id: parsed.id,
      label: parsed.label,
      shape: parsed.shape,
    };
    explicitNodes.add(parsed.id);
    return true;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("%%") || line.includes(";")) {
      return { ok: false, reason: "Comments and directives are Source-only" };
    }

    const edgeMatch = line.match(
      /^(.+?)\s+(-->|---|-\.->|==>)\s*(?:\|([^|\r\n]*)\|\s*)?(.+?)$/,
    );
    if (edgeMatch) {
      const from = parseNodeToken(edgeMatch[1]);
      const to = parseNodeToken(edgeMatch[4]);
      const type = edgeTypeFromSyntax(edgeMatch[2]);
      const label = edgeMatch[3]?.trim() ?? "";
      if (
        !from ||
        !to ||
        !type ||
        (label && /[<>|\r\n]/.test(label)) ||
        !addNode(from) ||
        !addNode(to)
      ) {
        return {
          ok: false,
          reason: duplicateExplicitNodeId
            ? `Duplicate flowchart node declaration: ${duplicateExplicitNodeId}`
            : `Unsupported flowchart statement: ${line}`,
        };
      }
      edges.push({
        id: `edge${edges.length + 1}`,
        from: from.id,
        to: to.id,
        label,
        type,
      });
      continue;
    }

    const node = parseNodeToken(line);
    if (!node || !addNode(node)) {
      return {
        ok: false,
        reason: duplicateExplicitNodeId
          ? `Duplicate flowchart node declaration: ${duplicateExplicitNodeId}`
          : `Unsupported flowchart statement: ${line}`,
      };
    }
  }

  return {
    ok: true,
    model: { kind: "flowchart", direction, nodes, edges },
  };
}

export function serializeFlowchartVisualModel(
  model: FlowchartVisualModel,
): string {
  const lines = [`flowchart ${model.direction}`];
  for (const node of model.nodes) {
    assertId(node.id);
    assertLabel(node.label);
    lines.push(`  ${serializeNode(node)}`);
  }
  for (const edge of model.edges) {
    if (!model.nodes.some((node) => node.id === edge.from)) {
      throw new Error(`Unknown connection source: ${edge.from}`);
    }
    if (!model.nodes.some((node) => node.id === edge.to)) {
      throw new Error(`Unknown connection target: ${edge.to}`);
    }
    if (edge.label) assertLabel(edge.label);
    const label = edge.label ? `|${edge.label}| ` : " ";
    lines.push(`  ${edge.from} ${EDGE_SYNTAX[edge.type]}${label}${edge.to}`);
  }
  return lines.join("\n");
}

function nextId(prefix: string, used: Set<string>): string {
  let index = 1;
  while (used.has(`${prefix}${index}`)) index += 1;
  return `${prefix}${index}`;
}

export function addFlowNode(
  model: FlowchartVisualModel,
  node: Pick<FlowNode, "label" | "shape"> & { id?: string },
): FlowchartVisualModel {
  const id =
    node.id ?? nextId("node", new Set(model.nodes.map((item) => item.id)));
  assertId(id);
  assertLabel(node.label);
  if (model.nodes.some((item) => item.id === id)) {
    throw new Error(`Flowchart node already exists: ${id}`);
  }
  return { ...model, nodes: [...model.nodes, { ...node, id }] };
}

export function updateFlowNode(
  model: FlowchartVisualModel,
  nodeId: string,
  patch: Partial<Pick<FlowNode, "id" | "label" | "shape">>,
): FlowchartVisualModel {
  const current = model.nodes.find((node) => node.id === nodeId);
  if (!current) throw new Error(`Unknown flowchart node: ${nodeId}`);
  const next = { ...current, ...patch };
  assertId(next.id);
  assertLabel(next.label);
  if (next.id !== nodeId && model.nodes.some((node) => node.id === next.id)) {
    throw new Error(`Flowchart node already exists: ${next.id}`);
  }
  return {
    ...model,
    nodes: model.nodes.map((node) => (node.id === nodeId ? next : node)),
    edges: model.edges.map((edge) => ({
      ...edge,
      from: edge.from === nodeId ? next.id : edge.from,
      to: edge.to === nodeId ? next.id : edge.to,
    })),
  };
}

export function deleteFlowNode(
  model: FlowchartVisualModel,
  nodeId: string,
): FlowchartVisualModel {
  return {
    ...model,
    nodes: model.nodes.filter((node) => node.id !== nodeId),
    edges: model.edges.filter(
      (edge) => edge.from !== nodeId && edge.to !== nodeId,
    ),
  };
}

export function addFlowEdge(
  model: FlowchartVisualModel,
  edge: Omit<FlowEdge, "id"> & { id?: string },
): FlowchartVisualModel {
  if (!model.nodes.some((node) => node.id === edge.from)) {
    throw new Error(`Unknown connection source: ${edge.from}`);
  }
  if (!model.nodes.some((node) => node.id === edge.to)) {
    throw new Error(`Unknown connection target: ${edge.to}`);
  }
  if (edge.label) assertLabel(edge.label);
  const id =
    edge.id ?? nextId("edge", new Set(model.edges.map((item) => item.id)));
  if (model.edges.some((item) => item.id === id)) {
    throw new Error(`Flowchart connection already exists: ${id}`);
  }
  return { ...model, edges: [...model.edges, { ...edge, id }] };
}

export function updateFlowEdge(
  model: FlowchartVisualModel,
  edgeId: string,
  patch: Partial<Omit<FlowEdge, "id">>,
): FlowchartVisualModel {
  const current = model.edges.find((edge) => edge.id === edgeId);
  if (!current) throw new Error(`Unknown flowchart connection: ${edgeId}`);
  const next = { ...current, ...patch };
  if (!model.nodes.some((node) => node.id === next.from)) {
    throw new Error(`Unknown connection source: ${next.from}`);
  }
  if (!model.nodes.some((node) => node.id === next.to)) {
    throw new Error(`Unknown connection target: ${next.to}`);
  }
  if (next.label) assertLabel(next.label);
  return {
    ...model,
    edges: model.edges.map((edge) => (edge.id === edgeId ? next : edge)),
  };
}

export function deleteFlowEdge(
  model: FlowchartVisualModel,
  edgeId: string,
): FlowchartVisualModel {
  return { ...model, edges: model.edges.filter((edge) => edge.id !== edgeId) };
}
