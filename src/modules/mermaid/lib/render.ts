import type { MermaidConfig } from "mermaid";

export type MermaidTheme = "light" | "dark";

export type MermaidRuntime = {
  initialize: (config: MermaidConfig) => unknown;
  parse: (source: string) => Promise<unknown>;
  render: (id: string, source: string) => Promise<{ svg: string }>;
};

// Mermaid keeps configuration in a process-global singleton. Serializing the
// complete initialize/parse/render transaction prevents concurrent tabs from
// changing security or theme settings underneath one another.
let mermaidRenderQueue: Promise<void> = Promise.resolve();

export function buildMermaidConfig(theme: MermaidTheme): MermaidConfig {
  return {
    startOnLoad: false,
    securityLevel: "strict",
    theme: theme === "dark" ? "dark" : "default",
    suppressErrorRendering: true,
    secure: [
      "secure",
      "securityLevel",
      "startOnLoad",
      "maxTextSize",
      "suppressErrorRendering",
      "maxEdges",
      "htmlLabels",
      "flowchart",
    ],
    htmlLabels: false,
    flowchart: { htmlLabels: false },
  };
}

export function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function renderMermaidSource(
  runtime: MermaidRuntime,
  source: string,
  renderId: string,
  theme: MermaidTheme,
): Promise<string> {
  const result = mermaidRenderQueue.then(async () => {
    runtime.initialize(buildMermaidConfig(theme));
    await runtime.parse(source);
    const { svg } = await runtime.render(renderId, source);
    return svg;
  });
  mermaidRenderQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export function validateMermaidSourceWithRuntime(
  runtime: MermaidRuntime,
  source: string,
  theme: MermaidTheme,
): Promise<void> {
  const result = mermaidRenderQueue.then(async () => {
    runtime.initialize(buildMermaidConfig(theme));
    await runtime.parse(source);
  });
  mermaidRenderQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
