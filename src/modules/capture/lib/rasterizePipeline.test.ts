import { afterEach, expect, it, vi } from "vitest";
import { rasterizeElement } from "@/modules/capture/lib/rasterize";
import type { NativeCaptureLease } from "@/modules/capture/lib/captureLease";

class Node {
  parentElement: Node | null = null;
  children: Node[] = [];
  style: Record<string, string> = {};
  attributes = new Map<string, string>();
  textContent = "";
  constructor(
    readonly kind: string,
    readonly rect = { left: 0, top: 0, width: 112, height: 92 },
  ) {}
  append(child: Node) {
    child.parentElement = this;
    this.children.push(child);
  }
  contains(node: unknown): boolean {
    return node === this || this.children.some((child) => child.contains(node));
  }
  hasAttribute(key: string) {
    return this.attributes.has(key);
  }
  setAttribute(key: string, value: string) {
    this.attributes.set(key, value);
  }
  removeAttribute(key: string) {
    this.attributes.delete(key);
  }
  getBoundingClientRect() {
    return this.rect;
  }
  closest(selector: string): Node | null {
    return selector === "[data-terminal-engine]" &&
      this.hasAttribute("data-terminal-engine")
      ? this
      : (this.parentElement?.closest(selector) ?? null);
  }
  querySelectorAll(selector: string): Node[] {
    const all = this.children.flatMap((child) => [
      child,
      ...child.querySelectorAll("*"),
    ]);
    if (selector === "*") return all;
    if (selector === "canvas")
      return all.filter((node) => node.kind === "canvas");
    if (selector === "input, textarea, select") return [];
    return all.filter((node) =>
      node.hasAttribute("data-terax-capture-foreground"),
    );
  }
  cloneNode(deep: boolean): Node {
    const clone = new Node(this.kind, { ...this.rect });
    clone.style = { ...this.style };
    clone.attributes = new Map(this.attributes);
    clone.textContent = this.textContent;
    if (deep)
      for (const child of this.children) clone.append(child.cloneNode(true));
    return clone;
  }
  remove() {
    if (this.parentElement)
      this.parentElement.children = this.parentElement.children.filter(
        (child) => child !== this,
      );
    this.parentElement = null;
  }
}
class CaptureImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  decoding = "";
  private value = "";
  url = "";
  get src() {
    return this.value;
  }
  set src(value: string) {
    this.value = value;
    if (value) this.url = value;
  }
}
afterEach(() => vi.unstubAllGlobals());
it("keeps frozen DOM order despite reverse image loads and removes live block headers from the base clone", async () => {
  const root = new Node("root"),
    native = new Node("native");
  root.style.visibility = native.style.visibility = "hidden";
  native.setAttribute("data-terminal-engine", "ghostty");
  root.append(native);
  const source = new Node("canvas", {
    left: 6,
    top: 6,
    width: 100,
    height: 80,
  });
  source.setAttribute("data-terax-capture-required", "");
  native.append(source);
  const frozen = new Node("frozen"),
    old = new Node("old"),
    error = new Node("error");
  frozen.style.visibility = "hidden";
  for (const node of [frozen, old, error]) {
    node.setAttribute("data-terax-capture-foreground", "");
    node.textContent = node.kind;
    native.append(node);
  }
  const images: CaptureImage[] = [];
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => context,
    toBlob: (done: (value: Blob) => void) => done(new Blob(["public"])),
  };
  const context = {
    drawImage: vi.fn(),
    fillRect: vi.fn(),
    scale: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
  };
  vi.stubGlobal("HTMLElement", Node);
  vi.stubGlobal("SVGElement", class {});
  vi.stubGlobal("document", {
    body: root,
    styleSheets: [],
    createElement: () => canvas,
  });
  vi.stubGlobal("window", {
    devicePixelRatio: 1,
    getComputedStyle: (node: Node) => {
      const visibility =
        node.style.visibility ??
        node.parentElement?.style.visibility ??
        "visible";
      return {
        length: 1,
        item: () => "visibility",
        getPropertyValue: () => visibility,
        visibility,
        display: "block",
        overflowX: "visible",
        overflowY: "visible",
        backgroundColor: "rgb(0, 0, 0)",
      };
    },
  });
  vi.stubGlobal(
    "XMLSerializer",
    class {
      serializeToString(node: Node): string {
        return JSON.stringify({
          text: node.textContent,
          attributes: [...node.attributes],
          children: node.children.map((child) => this.serializeToString(child)),
        });
      }
    },
  );
  vi.stubGlobal(
    "Image",
    class extends CaptureImage {
      constructor() {
        super();
        images.push(this);
      }
    },
  );
  const lease = {
    root: native as unknown as HTMLElement,
    canvas: source as unknown as HTMLCanvasElement,
    snapshot: "data:image/png;base64,full",
    excluded: [old, frozen] as unknown as Element[],
    foreground: frozen as unknown as HTMLElement,
    current: () => true,
    dispose: () => {},
  } satisfies NativeCaptureLease;
  const pending = rasterizeElement(root as unknown as HTMLElement, {
    leases: [lease],
    scope: { signal: new AbortController().signal, current: () => true },
  });
  await vi.waitFor(() => expect(images).toHaveLength(1));
  expect(decodeURIComponent(images[0].url)).not.toContain("old");
  images[0].onload?.();
  await vi.waitFor(() => expect(images).toHaveLength(3));
  images[2].onload?.();
  await vi.waitFor(() => expect(images[2].onload).toBeNull());
  images[1].onload?.();
  await vi.waitFor(() => expect(images).toHaveLength(4));
  images[3].onload?.();
  const result = await pending;
  expect(context.drawImage.mock.calls.map((call) => call[0])).toEqual([
    images[0],
    images[3],
    images[1],
    images[2],
  ]);
  expect(images.every((image) => image.src === "")).toBe(true);
  expect(canvas.width).toBe(0);
  expect(canvas.height).toBe(0);
  expect(result.width).toBe(112);
});
