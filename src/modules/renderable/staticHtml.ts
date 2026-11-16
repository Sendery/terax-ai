export type StaticHtmlNode = {
  text?: string;
  tag?: string;
  namespace?: string;
  attributes?: [string, string][];
  children?: StaticHtmlNode[];
};
const tags = new Set(
  "a abbr address article aside b bdi bdo blockquote br caption cite code col colgroup dd del details dfn div dl dt em figcaption figure footer h1 h2 h3 h4 h5 h6 header hgroup hr i img ins kbd li main mark nav ol p pre q rp rt ruby s samp section small span strong sub summary sup table tbody td tfoot th thead time tr u ul var wbr style".split(
    " ",
  ),
);
const attributes = new Set(
  "class id title lang dir style alt width height colspan rowspan scope open start reversed type datetime".split(
    " ",
  ),
);
const voids = new Set(["br", "col", "hr", "img", "wbr"]);
export const HTML_PREVIEW_CSP =
  "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
export function serializeStaticHtml(nodes: StaticHtmlNode[]): string {
  let count = 0;
  const serialize = (items: StaticHtmlNode[], depth = 0): string =>
    items
      .map((node) => {
        if (depth > 128 || ++count > 20000)
          throw new Error("HTML preview exceeds its structure limit");
        if (node.text !== undefined) return escapeHtml(node.text);
        const tag = node.tag?.toLowerCase() ?? "";
        if (node.namespace && node.namespace !== "http://www.w3.org/1999/xhtml")
          return "";
        if (["html", "head", "body"].includes(tag))
          return serialize(node.children ?? [], depth + 1);
        if (!tags.has(tag)) return "";
        if (tag === "style")
          return `<style>${(node.children ?? [])
            .map((child) => child.text ?? "")
            .join("")
            .replace(/</g, "\\3c ")}</style>`;
        const attrs = (node.attributes ?? [])
          .filter(
            ([name, value]) =>
              attributes.has(name) ||
              (tag === "img" &&
                name === "src" &&
                /^data:image\/(?:png|jpeg|gif|webp);base64,[a-zA-Z0-9+/=\s]+$/.test(
                  value,
                )),
          )
          .map(([name, value]) => ` ${name}="${escapeHtml(value)}"`)
          .join("");
        return `<${tag}${attrs}>${voids.has(tag) ? "" : `${serialize(node.children ?? [], depth + 1)}</${tag}>`}`;
      })
      .join("");
  return serialize(nodes);
}
export function staticHtmlDocument(nodes: StaticHtmlNode[]): string {
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${escapeHtml(HTML_PREVIEW_CSP)}"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>${serializeStaticHtml(nodes)}</body></html>`;
}
export function parseStaticHtml(source: string): StaticHtmlNode[] {
  // Template contents are inert, including images, frames and custom elements.
  const template = document.createElement("template");
  template.innerHTML = source;
  let count = 0;
  const visit = (node: Node, depth = 0): StaticHtmlNode => {
    if (depth > 128 || ++count > 20000)
      throw new Error("HTML preview exceeds its structure limit");
    if (node.nodeType === Node.TEXT_NODE)
      return { text: node.textContent ?? "" };
    if (!(node instanceof Element)) return {};
    return {
      tag: node.localName,
      namespace: node.namespaceURI ?? undefined,
      attributes: Array.from(node.attributes, (attr) => [
        attr.name,
        attr.value,
      ]),
      children: Array.from(node.childNodes, (child) => visit(child, depth + 1)),
    };
  };
  return Array.from(template.content.childNodes, (node) => visit(node));
}
