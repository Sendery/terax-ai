import { describe, expect, it } from "vitest";

import {
  isLinkActivation,
  isSecondaryClick,
  rightClickSelectsWord,
} from "./pointer";

const click = (button: number, ctrlKey = false) => ({ button, ctrlKey });

describe("isLinkActivation", () => {
  it("opens a link on a primary click", () => {
    expect(isLinkActivation(click(0), true)).toBe(true);
    expect(isLinkActivation(click(0), false)).toBe(true);
  });

  it("never opens a link on a right or middle click", () => {
    expect(isLinkActivation(click(2), true)).toBe(false);
    expect(isLinkActivation(click(2), false)).toBe(false);
    expect(isLinkActivation(click(1), false)).toBe(false);
  });

  it("treats Ctrl+click as a right-click on macOS only", () => {
    expect(isLinkActivation(click(0, true), true)).toBe(false);
    expect(isLinkActivation(click(0, true), false)).toBe(true);
  });
});

describe("isSecondaryClick", () => {
  it("covers the right button and macOS Ctrl+click", () => {
    expect(isSecondaryClick(click(2), false)).toBe(true);
    expect(isSecondaryClick(click(0, true), true)).toBe(true);
    expect(isSecondaryClick(click(0, true), false)).toBe(false);
    expect(isSecondaryClick(click(0), true)).toBe(false);
  });
});

describe("rightClickSelectsWord", () => {
  it("keeps a selection the user made", () => {
    expect(rightClickSelectsWord(true, true)).toBe(false);
  });

  it("selects the word or link under the pointer when nothing is selected on macOS", () => {
    expect(rightClickSelectsWord(true, false)).toBe(true);
    expect(rightClickSelectsWord(false, false)).toBe(false);
  });
});
