import {
  mermaidErrorMessage,
  renderMermaidSource,
  svgToDataUrl,
  validateMermaidSource,
} from "@/modules/mermaid";
import { useTheme } from "@/modules/theme";
import { type ReactNode, useEffect, useId, useMemo, useState } from "react";

type Props = {
  code: string;
  /** The plain code block, shown when the source cannot be drawn. */
  fallback: ReactNode;
};

type State =
  | { kind: "pending" }
  | { kind: "ready"; svg: string }
  | { kind: "error"; message: string };

/**
 * A ```mermaid fence in rendered markdown, drawn with the same engine and the
 * same hardened configuration as a Mermaid tab.
 *
 * Rendering goes through `renderMermaidSource` rather than calling the mermaid
 * module directly: mermaid keeps its configuration in a process-global
 * singleton, and that helper serializes the whole initialize/parse/render
 * transaction so a diagram in a markdown file cannot change the security level
 * or theme underneath a Mermaid tab rendering at the same time.
 *
 * The SVG is shown through a data URL rather than injected as markup, because
 * the source is an arbitrary file the user opened.
 */
export function MarkdownMermaid({ code, fallback }: Props) {
  const { resolvedMode } = useTheme();
  const reactId = useId();
  const [state, setState] = useState<State>({ kind: "pending" });

  useEffect(() => {
    const validation = validateMermaidSource(code);
    if (!validation.ok) {
      setState({ kind: "error", message: validation.message });
      return;
    }
    let cancelled = false;
    setState({ kind: "pending" });
    // Mermaid derives DOM ids from this, so keep it to characters a selector
    // accepts and unique per mount.
    const renderId = `terax-md-mermaid-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}-${Date.now()}`;
    void (async () => {
      try {
        const runtime = (await import("mermaid")).default;
        const svg = await renderMermaidSource(
          runtime,
          validation.source,
          renderId,
          resolvedMode,
        );
        if (!cancelled) setState({ kind: "ready", svg });
      } catch (error) {
        if (!cancelled) {
          setState({ kind: "error", message: mermaidErrorMessage(error) });
        }
      } finally {
        // Mermaid leaves the container it measured in behind on both paths.
        document.getElementById(`d${renderId}`)?.remove();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, resolvedMode, reactId]);

  const svgUrl = useMemo(
    () => (state.kind === "ready" ? svgToDataUrl(state.svg) : ""),
    [state],
  );

  if (state.kind === "error") {
    return (
      <div className="my-4 flex w-full flex-col gap-2">
        <p className="text-[12px] text-muted-foreground">
          Could not render this Mermaid diagram: {state.message}
        </p>
        {fallback}
      </div>
    );
  }

  if (state.kind === "pending") {
    return (
      <div className="my-4 grid h-24 w-full place-items-center rounded-md border border-border bg-sidebar text-[12px] text-muted-foreground">
        Rendering diagram…
      </div>
    );
  }

  return (
    <div className="my-4 w-full overflow-auto rounded-md border border-border bg-background p-4">
      <img
        alt="Rendered Mermaid diagram"
        className="mx-auto block h-auto max-w-full"
        src={svgUrl}
      />
    </div>
  );
}
