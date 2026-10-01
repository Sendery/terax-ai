import type { MermaidVisualLayout } from "@/modules/tabs";
import {
  type FlowchartVisualModel,
  parseFlowchartVisualSource,
  serializeFlowchartVisualModel,
} from "./flowchartModel";
import {
  parseSequenceVisualSource,
  type SequenceVisualModel,
  serializeSequenceVisualModel,
} from "./sequenceModel";
import { normalizeFlowLayout } from "./visualLayout";

const MAX_VISUAL_FLOW_NODES = 256;
const MAX_VISUAL_FLOW_EDGES = 256;
const MAX_VISUAL_SEQUENCE_PARTICIPANTS = 128;
const MAX_VISUAL_SEQUENCE_MESSAGES = 512;

export type FlowchartVisualDocument = {
  kind: "flowchart";
  model: FlowchartVisualModel;
  layout: MermaidVisualLayout;
};

export type SequenceVisualDocument = {
  kind: "sequence";
  model: SequenceVisualModel;
};

export type MermaidVisualDocument =
  | FlowchartVisualDocument
  | SequenceVisualDocument;

export type MermaidVisualClassification =
  | { status: "editable"; document: MermaidVisualDocument }
  | { status: "locked"; reason: string };

export function classifyMermaidVisualSource(
  source: string,
  layout?: MermaidVisualLayout,
): MermaidVisualClassification {
  const first = source.replace(/^\s+/, "").split(/\r?\n/, 1)[0]?.trim() ?? "";
  if (/^(?:flowchart|graph)\b/i.test(first)) {
    const parsed = parseFlowchartVisualSource(source);
    if (!parsed.ok) return { status: "locked", reason: parsed.reason };
    if (parsed.model.nodes.length > MAX_VISUAL_FLOW_NODES) {
      return {
        status: "locked",
        reason: `Visual flowcharts support at most ${MAX_VISUAL_FLOW_NODES} nodes`,
      };
    }
    if (parsed.model.edges.length > MAX_VISUAL_FLOW_EDGES) {
      return {
        status: "locked",
        reason: `Visual flowcharts support at most ${MAX_VISUAL_FLOW_EDGES} edges`,
      };
    }
    return {
      status: "editable",
      document: {
        kind: "flowchart",
        model: parsed.model,
        layout: normalizeFlowLayout(parsed.model.nodes, layout),
      },
    };
  }
  if (first === "sequenceDiagram") {
    const parsed = parseSequenceVisualSource(source);
    if (!parsed.ok) return { status: "locked", reason: parsed.reason };
    if (parsed.model.participants.length > MAX_VISUAL_SEQUENCE_PARTICIPANTS) {
      return {
        status: "locked",
        reason: `Visual sequence diagrams support at most ${MAX_VISUAL_SEQUENCE_PARTICIPANTS} participants`,
      };
    }
    if (parsed.model.messages.length > MAX_VISUAL_SEQUENCE_MESSAGES) {
      return {
        status: "locked",
        reason: `Visual sequence diagrams support at most ${MAX_VISUAL_SEQUENCE_MESSAGES} messages`,
      };
    }
    return {
      status: "editable",
      document: { kind: "sequence", model: parsed.model },
    };
  }
  return {
    status: "locked",
    reason:
      "Visual editing currently supports flowcharts and sequence diagrams",
  };
}

export function serializeMermaidVisualDocument(
  document: MermaidVisualDocument,
): string {
  return document.kind === "flowchart"
    ? serializeFlowchartVisualModel(document.model)
    : serializeSequenceVisualModel(document.model);
}
