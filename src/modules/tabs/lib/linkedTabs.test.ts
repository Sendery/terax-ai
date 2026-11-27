import { describe, expect, it } from "vitest";
import { hydrateTabs, serializeTabs } from "@/modules/spaces/lib/serialize";
import { cleanLinkedTabs, indexLinkedTabs, linkTabs, resizeLinkedTabs, unlinkTabs } from "./linkedTabs";
import type { Tab } from "./useTabs";

const key = "e07bc755-0de0-4052-a077-45caa0ec1ffc";
const terminal: Tab = {
  id: 1, title: "Shell", kind: "terminal", spaceId: "work", activeLeafId: 10,
  paneTree: { kind: "leaf", id: 10 }, cold: true,
};
const image: Tab = {
  id: 2, title: "diagram.png", kind: "editor", spaceId: "work",
  path: "/work/diagram.png", dirty: false, preview: true, cold: true,
};

describe("linked tabs", () => {
  it("keeps two tab IDs, warms their content, and pins a transient editor", () => {
    const linked = linkTabs([terminal, image], 1, 2, key);
    expect(linked).toMatchObject([
      { id: 1, cold: false, paneTree: terminal.paneTree },
      { id: 2, cold: false, preview: false, path: image.path },
    ]);
    const pairs = indexLinkedTabs(linked);
    expect(pairs.get(1)).toEqual({ key, leftId: 1, rightId: 2, percent: 50 });
    expect(pairs.get(1)).toBe(pairs.get(2));
    expect(indexLinkedTabs(unlinkTabs(linked, 2)).size).toBe(0);
  });

  it("restores width and orientation with fresh runtime IDs", () => {
    const linked = resizeLinkedTabs(linkTabs([terminal, image], 2, 1, key), key, 61);
    let next = 90;
    const restored = hydrateTabs(serializeTabs(linked), "work", () => ++next);
    expect(indexLinkedTabs(restored).get(restored[1].id)).toEqual({
      key, leftId: restored[1].id, rightId: restored[0].id, percent: 61,
    });
  });

  it("cleans links if a tab is closed or moved and refuses private shells", () => {
    const linked = linkTabs([terminal, image], 1, 2, key);
    expect(cleanLinkedTabs([linked[0]])[0].linkedView).toBeUndefined();
    expect(cleanLinkedTabs([linked[0], { ...linked[1], spaceId: "other" }])
      .every((tab) => !tab.linkedView)).toBe(true);
    const privatePair = [{ ...terminal, private: true }, image];
    expect(linkTabs(privatePair, 1, 2, key)).toBe(privatePair);
  });
});
