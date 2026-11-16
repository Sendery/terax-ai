import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { RenderableLayout } from "@/modules/renderable/RenderableLayout";
import { ViewModeToggle } from "@/modules/renderable/ViewModeToggle";
import { VIEW_MODES } from "@/modules/renderable/viewMode";
it("does not mount the renderer in Raw and retains the raw subtree in every mode", () => {
  let renders = 0;
  function Heavy() {
    renders++;
    return <p>render result</p>;
  }
  for (const mode of VIEW_MODES) {
    const before = renders;
    const html = renderToStaticMarkup(
      <RenderableLayout
        mode={mode}
        raw={<textarea defaultValue="unsaved draft" />}
        rendered={<Heavy />}
      />,
    );
    expect(html).toContain("unsaved draft");
    expect(renders - before).toBe(mode === "raw" ? 0 : 1);
  }
});
it("announces one selected view and uses keyboard-operable native controls", () => {
  for (const mode of VIEW_MODES) {
    const html = renderToStaticMarkup(
      <ViewModeToggle mode={mode} onChange={() => {}} />,
    );
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html.match(/<button/g)).toHaveLength(3);
    for (const label of ["Raw", "Rendered", "Side by side"])
      expect(html).toContain(label);
  }
});
it("keeps panel IDs unique across simultaneously mounted document tabs", () => {
  const html = renderToStaticMarkup(
    <>
      <RenderableLayout mode="raw" raw="first" rendered="first preview" />
      <RenderableLayout
        mode="rendered"
        raw="second"
        rendered="second preview"
      />
    </>,
  );
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  expect(new Set(ids).size).toBe(ids.length);
});
