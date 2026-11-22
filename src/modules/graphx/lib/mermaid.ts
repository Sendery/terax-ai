/**
 * Which Mermaid sources GraphX draws.
 *
 * The pinned GraphX bundle carries its own Mermaid converter (`GraphX.fromMermaid`), which
 * runs inside the sandboxed GraphX frame. It reads diagrams of parts and connections and
 * refuses data charts (pie, xychart, quadrantChart, radar, packet, venn) and ZenUML.
 * Those, and anything it does not recognise, keep the Mermaid renderer as their fallback.
 *
 * The keyword table mirrors the converter's `TYPES` list; `mermaid.test.ts` checks it
 * against the bundled engine so the two cannot drift apart.
 */
const GRAPHX_MERMAID_TYPES: readonly RegExp[] = [
  /^(flowchart|flowchart-elk|graph)\b/,
  /^sequenceDiagram\b/,
  /^classDiagram(-v2)?\b/,
  /^stateDiagram(-v2)?\b/,
  /^erDiagram\b/,
  /^mindmap\b/,
  /^gantt\b/,
  /^journey\b/,
  /^timeline\b/,
  /^gitGraph\b/,
  /^C4(Context|Container|Component|Dynamic|Deployment)\b/,
  /^architecture(-beta)?\b/,
  /^block(-beta)?\b/,
  /^requirementDiagram\b/,
  /^sankey(-beta)?\b/,
  /^kanban\b/,
  /^treemap(-beta)?\b/,
];

const FRONTMATTER = /^\s*---\n[\s\S]*?\n---[ \t]*(?:\n|$)/;
const DIRECTIVE = /%%\{[\s\S]*?\}%%/g;
const ACCESSIBILITY = /^acc(?:Title|Descr)\b/;

/** First statement of a Mermaid source, ignoring frontmatter, directives and comments. */
export function mermaidHeader(source: string): string | null {
  let text = source.replace(/\r\n?/g, "\n").replace(/^﻿/, "");
  text = text.replace(FRONTMATTER, "").replace(DIRECTIVE, "");
  let inDescription = false;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/%%.*$/, "").trim();
    if (inDescription) {
      if (line === "}") inDescription = false;
      continue;
    }
    if (!line) continue;
    if (/^accDescr\s*\{\s*$/.test(line)) {
      inDescription = true;
      continue;
    }
    if (ACCESSIBILITY.test(line)) continue;
    return line;
  }
  return null;
}

/** The diagram keyword (`flowchart`, `pie`, `sequenceDiagram`...), or null when empty. */
export function mermaidDiagramType(source: string): string | null {
  const header = mermaidHeader(source);
  return header ? (header.split(/[\s:;]/)[0] ?? null) : null;
}

/** True when GraphX's converter reads this kind of diagram. */
export function graphxDrawsMermaid(source: string): boolean {
  const header = mermaidHeader(source);
  return !!header && GRAPHX_MERMAID_TYPES.some((type) => type.test(header));
}
