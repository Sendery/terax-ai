import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import {
  HTML_PREVIEW_CSP,
  staticHtmlDocument,
  type StaticHtmlNode,
} from "@/modules/renderable/staticHtml";
// Exercise the installed HTML5 parser already used by Streamdown, without a browser process.
const parserRequire = createRequire(
  new URL(
    "../../../node_modules/.pnpm/node_modules/package.json",
    import.meta.url,
  ),
);
type Parsed = {
  nodeName: string;
  tagName?: string;
  value?: string;
  namespaceURI?: string;
  attrs?: { name: string; value: string }[];
  childNodes?: Parsed[];
};
const parser = parserRequire("parse5") as {
  parseFragment(source: string): Parsed;
};
function sanitize(source: string) {
  const visit = (node: Parsed): StaticHtmlNode =>
    node.nodeName === "#text"
      ? { text: node.value }
      : {
          tag: node.tagName,
          namespace: node.namespaceURI,
          attributes: node.attrs?.map((a) => [a.name, a.value]),
          children: node.childNodes?.map(visit),
        };
  return staticHtmlDocument(
    parser.parseFragment(source).childNodes?.map(visit) ?? [],
  );
}
describe("static HTML boundary", () => {
  it.each([
    '<script>parent.__TAURI_INTERNALS__.invoke("fs_read_file")</script>',
    '<img src="asset://localhost/etc/passwd" onerror="window.open(1)">',
    '<iframe srcdoc="&lt;script&gt;parent.location=1&lt;/script&gt;"></iframe>',
    '<meta http-equiv="refresh" content="0;url=https://attacker.invalid"><base href="file:///">',
    '<a href="javascript:alert(1)" target="_top" ping="https://attacker.invalid">click</a>',
    '<form action="https://attacker.invalid"><input autofocus onfocus="parent.postMessage(1)"></form>',
    '<svg><a xlink:href="javascript:alert(1)"><text>bad</text></a><foreignObject><iframe src="https://attacker.invalid"></iframe></foreignObject></svg>',
    '<math><mtext><table><mglyph><style><!--</style><img title="--><img src=x onerror=alert(1)>">',
    '<object data="file:///secret"><embed src="tauri://localhost"></object>',
    "<template><script>alert(1)</script></template><button popovertarget=x onclick=alert(1)>click</button>",
  ])("removes active/navigation/resource payloads: %s", (payload) => {
    const html = sanitize(payload);
    const body = html.slice(html.indexOf("<body>"));
    expect(body).not.toMatch(
      /<script|<iframe|<object|<embed|<meta|<base|<svg|<math|<form|\son\w+=|href=|srcdoc=|ping=|action=|asset:|file:|tauri:|javascript:/i,
    );
    expect(html.indexOf("Content-Security-Policy")).toBeLessThan(
      html.indexOf("<body>"),
    );
  });
  it("preserves static content and inert styles but removes external and relative resources", () => {
    const html = sanitize(
      '<style>p {color:red;background:url(https://attacker.invalid/x)}</style><h1 title="a &quot;b&quot;">Hello &amp; goodbye</h1><p style="color:blue">kept</p><img src="./private.png"><img src="data:image/png;base64,AAAA"><link rel="stylesheet" href="./secret.css">',
    );
    expect(html).toContain(
      '<h1 title="a &quot;b&quot;">Hello &amp; goodbye</h1>',
    );
    expect(html).toContain('style="color:blue"');
    expect(html).toContain('src="data:image/png;base64,AAAA"');
    expect(html).not.toContain("./private");
    expect(html).not.toContain("./secret");
    expect(HTML_PREVIEW_CSP).toContain("default-src 'none'");
    expect(HTML_PREVIEW_CSP).toContain("script-src 'none'");
    expect(HTML_PREVIEW_CSP).toContain("img-src data:");
  });
  it("does not reintroduce active markup through decoded text or attributes", () => {
    const html = sanitize(
      '<p title="&quot; onmouseover=&quot;evil">&lt;script&gt;evil&lt;/script&gt;</p>',
    );
    const reparsed = parser.parseFragment(html);
    const visit = (node: Parsed): void => {
      expect(node.tagName).not.toBe("script");
      expect(node.attrs?.some((a) => a.name.startsWith("on"))).not.toBe(true);
      node.childNodes?.forEach(visit);
    };
    visit(reparsed);
  });
});

it("bounds deeply nested or excessively broad documents before exhausting the stack", () => {
  let node: StaticHtmlNode = { text: "bottom" };
  for (let n = 0; n < 1000; n++) node = { tag: "div", children: [node] };
  expect(() => staticHtmlDocument([node])).toThrow("structure limit");
  expect(() =>
    staticHtmlDocument(Array.from({ length: 20001 }, () => ({ text: "x" }))),
  ).toThrow("structure limit");
});
