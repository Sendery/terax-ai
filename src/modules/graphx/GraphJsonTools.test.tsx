import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { GraphJsonTools } from "./GraphJsonTools";

it("exposes a keyboard-operable format button and live syntax location without touching the editor", () => {
  const getView = vi.fn();
  const html = renderToStaticMarkup(
    <GraphJsonTools source={'{\n  "x": }'} getView={getView} />,
  );
  expect(html).toContain('type="button"');
  expect(html).toContain("Format JSON");
  expect(html).toContain('role="status"');
  expect(html).toContain('aria-live="polite"');
  expect(html).toContain("Invalid JSON at line 2, column 8");
  expect(getView).not.toHaveBeenCalled();
});
