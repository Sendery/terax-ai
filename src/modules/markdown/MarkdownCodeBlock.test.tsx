import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/ai-elements/markdown-code", async () => {
  const actual = await vi.importActual<
    typeof import("@/components/ai-elements/markdown-code")
  >("@/components/ai-elements/markdown-code");
  return {
    markdownCodeText: actual.markdownCodeText,
    MarkdownCode: ({ className }: { className?: string }) => (
      <pre data-test="code-block" data-language={className} />
    ),
  };
});

vi.mock("./MarkdownMermaid", () => ({
  MarkdownMermaid: ({ code }: { code: string }) => (
    <div data-test="mermaid" data-code={code} />
  ),
}));

import { MarkdownCodeBlock } from "./MarkdownCodeBlock";

describe("MarkdownCodeBlock", () => {
  it("draws a mermaid fence as a diagram instead of a code block", () => {
    const html = renderToStaticMarkup(
      <MarkdownCodeBlock className="language-mermaid">
        {"graph TD\n  A --> B\n"}
      </MarkdownCodeBlock>,
    );

    expect(html).toContain('data-test="mermaid"');
    expect(html).not.toContain('data-test="code-block"');
  });

  it("passes the fence body through without its trailing newline", () => {
    const html = renderToStaticMarkup(
      <MarkdownCodeBlock className="language-mermaid">
        {"graph TD\n  A --> B\n"}
      </MarkdownCodeBlock>,
    );

    expect(html).toContain('data-code="graph TD\n  A --&gt; B"');
  });

  it("leaves every other language as a code block", () => {
    for (const language of ["ts", "bash", "mmd", "mermaidish"]) {
      const html = renderToStaticMarkup(
        <MarkdownCodeBlock className={`language-${language}`}>
          {"const a = 1\n"}
        </MarkdownCodeBlock>,
      );

      expect(html).toContain('data-test="code-block"');
      expect(html).not.toContain('data-test="mermaid"');
    }
  });

  it("leaves inline code, which carries no language, to the code component", () => {
    const html = renderToStaticMarkup(
      <MarkdownCodeBlock>{"inline"}</MarkdownCodeBlock>,
    );

    expect(html).toContain('data-test="code-block"');
    expect(html).not.toContain('data-test="mermaid"');
  });
});
