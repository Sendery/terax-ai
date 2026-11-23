import {
  MarkdownCode,
  markdownCodeText,
} from "@/components/ai-elements/markdown-code";
import type { ReactNode } from "react";
import { MarkdownDiagram } from "./MarkdownDiagram";

const LANGUAGE = /language-([\w-]+)/;

export type MarkdownCodeBlockProps = {
  className?: string;
  children?: ReactNode;
};

/**
 * Streamdown `components.code` override for every rendered-markdown surface.
 *
 * Overriding `code` replaces Streamdown's own code renderer wholesale, and that
 * renderer is where it dispatches ```mermaid fences to a diagram. Overriding it
 * for the syntax highlighting therefore silently opted every surface out of
 * diagrams, so the dispatch has to be re-made here.
 *
 * Streamdown can draw them itself given a `plugins.mermaid`, but it would call
 * the mermaid module directly, outside the serialization that keeps concurrent
 * renders from rewriting each other's global configuration. The app's own
 * pipeline draws them with GraphX by default and keeps the hardened, serialized
 * Mermaid renderer only as the fallback for diagrams GraphX does not draw.
 */
export function MarkdownCodeBlock({
  className,
  children,
  ...rest
}: MarkdownCodeBlockProps) {
  const codeBlock = (
    <MarkdownCode className={className} {...rest}>
      {children}
    </MarkdownCode>
  );
  if (className?.match(LANGUAGE)?.[1] !== "mermaid") return codeBlock;
  return (
    <MarkdownDiagram
      code={markdownCodeText(children).replace(/\n$/, "")}
      fallback={codeBlock}
    />
  );
}
