import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("@tauri-apps/api/path", () => ({ homeDir: async () => "/public" }));
import { BlockOverlaySnapshot } from "@/modules/terminal/block/BlockOverlay";
import type { PositionedBlock } from "@/modules/terminal/block/lib/blockDecorations";

it("renders the shared completed and sticky chrome as inert frozen metadata", () => {
  const block: PositionedBlock = {
    id: "b1",
    command: "printf '<safe>'",
    cwd: "/public/project",
    exitCode: 2,
    running: false,
    ok: false,
    startedAt: 1700000000000,
    finishedAt: 1700000001000,
    top: 22,
    bottom: 54,
    headerTop: 7.6,
  };
  const html = renderToStaticMarkup(
    <BlockOverlaySnapshot
      visible={{ blocks: [block], sticky: block }}
      promptReady
    />,
  );
  expect(html).toContain("inert");
  expect(html).toContain('aria-hidden="true"');
  expect(html).toContain("bt-bar");
  expect(html).toContain("bt-sticky");
  expect(html).toContain("exit 2");
  expect(html).toContain("&lt;safe&gt;");
  expect(html).toContain("top:7.6px");
});
