export type PointerButtonEvent = Pick<MouseEvent, "button" | "ctrlKey">;

/** macOS turns Ctrl+click into a secondary click: it opens the context menu. */
export function isSecondaryClick(
  event: PointerButtonEvent,
  isMac: boolean,
): boolean {
  return event.button === 2 || (isMac && event.button === 0 && event.ctrlKey);
}

/** xterm activates a link on the mouseup of any button; only a primary click
 * may open it, so a right-click reaches the context menu instead. */
export function isLinkActivation(
  event: PointerButtonEvent,
  isMac: boolean,
): boolean {
  return event.button === 0 && !isSecondaryClick(event, isMac);
}

/** xterm's macOS right-click selects the word or link under the pointer. That
 * is how a right-clicked link becomes the menu's selection, but over a
 * selection the user made it would replace their text with one word. */
export function rightClickSelectsWord(
  isMac: boolean,
  hasSelection: boolean,
): boolean {
  return isMac && !hasSelection;
}
