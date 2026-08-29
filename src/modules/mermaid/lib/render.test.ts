import { describe, expect, it, vi } from "vitest";
import {
  buildMermaidConfig,
  renderMermaidSource,
  svgToDataUrl,
  validateMermaidSourceWithRuntime,
} from "./render";

describe("buildMermaidConfig", () => {
  it("uses Mermaid strict mode and never starts an ambient document scan", () => {
    expect(buildMermaidConfig("dark")).toMatchObject({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "dark",
      suppressErrorRendering: true,
      secure: expect.arrayContaining(["flowchart"]),
      flowchart: { htmlLabels: false },
    });
  });

  it("blocks root htmlLabels directives in the real Mermaid runtime", async () => {
    const { default: mermaid } = await import("mermaid");
    mermaid.initialize(buildMermaidConfig("light"));

    await mermaid.parse(
      '%%{init: {"htmlLabels": true, "flowchart": {"htmlLabels": true}}}%%\nflowchart LR\nA-->B',
    );

    const config = mermaid.mermaidAPI.getConfig();
    expect(config.htmlLabels).toBe(false);
    expect(config.flowchart?.htmlLabels).toBe(false);
  });
});

describe("svgToDataUrl", () => {
  it("encodes SVG as an inert image source instead of HTML markup", () => {
    const svg = "<svg><script>alert(1)</script><text>safe label</text></svg>";
    const url = svgToDataUrl(svg);

    expect(url).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
    expect(url).not.toContain("<script>");
    expect(decodeURIComponent(url.split(",", 2)[1])).toBe(svg);
  });
});

describe("renderMermaidSource", () => {
  it("validates generated source through the serialized Mermaid runtime without rendering", async () => {
    const calls: string[] = [];
    const runtime = {
      initialize: vi.fn(() => calls.push("initialize")),
      parse: vi.fn(async () => {
        calls.push("parse");
        return true;
      }),
      render: vi.fn(),
    };

    await expect(
      validateMermaidSourceWithRuntime(
        runtime,
        "flowchart LR\n  A --> B",
        "dark",
      ),
    ).resolves.toBeUndefined();
    expect(calls).toEqual(["initialize", "parse"]);
    expect(runtime.render).not.toHaveBeenCalled();
  });

  it("parses before rendering and returns the generated SVG", async () => {
    const calls: string[] = [];
    const runtime = {
      initialize: vi.fn(() => calls.push("initialize")),
      parse: vi.fn(async () => {
        calls.push("parse");
        return true;
      }),
      render: vi.fn(async () => {
        calls.push("render");
        return { svg: '<svg aria-label="diagram"></svg>' };
      }),
    };

    await expect(
      renderMermaidSource(runtime, "flowchart LR\nA-->B", "mermaid-7", "light"),
    ).resolves.toBe('<svg aria-label="diagram"></svg>');
    expect(calls).toEqual(["initialize", "parse", "render"]);
    expect(runtime.render).toHaveBeenCalledWith(
      "mermaid-7",
      "flowchart LR\nA-->B",
    );
  });

  it("does not attempt to render invalid source", async () => {
    const runtime = {
      initialize: vi.fn(),
      parse: vi.fn(async () => {
        throw new Error("Parse error on line 2");
      }),
      render: vi.fn(),
    };

    await expect(
      renderMermaidSource(runtime, "flowchart LR\nA--", "mermaid-8", "dark"),
    ).rejects.toThrow("Parse error on line 2");
    expect(runtime.render).not.toHaveBeenCalled();
  });

  it("serializes renders because Mermaid configuration is global", async () => {
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const calls: string[] = [];
    const runtime = {
      initialize: vi.fn((config: { theme?: string }) => {
        calls.push(`initialize:${config.theme}`);
      }),
      parse: vi.fn(async (source: string) => {
        calls.push(`parse:${source}`);
        if (source === "first") await firstBlocked;
        return true;
      }),
      render: vi.fn(async (_id: string, source: string) => {
        calls.push(`render:${source}`);
        return { svg: `<svg>${source}</svg>` };
      }),
    };

    const first = renderMermaidSource(runtime, "first", "one", "light");
    await vi.waitFor(() => expect(calls).toContain("parse:first"));
    const second = renderMermaidSource(runtime, "second", "two", "dark");
    await Promise.resolve();

    expect(calls).not.toContain("initialize:dark");
    releaseFirst();
    await expect(Promise.all([first, second])).resolves.toEqual([
      "<svg>first</svg>",
      "<svg>second</svg>",
    ]);
    expect(calls).toEqual([
      "initialize:default",
      "parse:first",
      "render:first",
      "initialize:dark",
      "parse:second",
      "render:second",
    ]);
  });
});
