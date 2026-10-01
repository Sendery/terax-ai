import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { VisualMutationBoundary } from "./MermaidVisualEditor";

describe("VisualMutationBoundary", () => {
  it("disables every form and drag activator while Mermaid validates", () => {
    const markup = renderToStaticMarkup(
      <VisualMutationBoundary disabled>
        <button type="button">Move</button>
        <input aria-label="Node label" />
      </VisualMutationBoundary>,
    );

    expect(markup).toContain("<fieldset");
    expect(markup).toContain('disabled=""');
    expect(markup).toContain('aria-busy="true"');
  });
});
