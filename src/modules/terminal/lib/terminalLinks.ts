import { openExternalUrl } from "@/lib/external-link";

/** The subset of xterm's `IBuffer` needed to read a linkified row. */
export type LinkRowSource = {
  getLine(
    index: number,
  ): { translateToString(trimRight?: boolean): string } | undefined;
};

/**
 * Read the row of text a link provider was asked about.
 *
 * The two xterm coordinate systems involved differ by one and must not be
 * mixed: `ILinkProvider.provideLinks` receives a **1-based** row of the whole
 * buffer (xterm's `Linkifier2` adds `buffer.ydisp` to the 1-based viewport row
 * `getCoords` derives from the mouse position), while `IBuffer.getLine` indexes
 * that same buffer **0-based**. Indexing with the raw row number returns the
 * line *below* the one being linkified, which puts every link one row above the
 * text it was parsed from.
 */
export function readLinkRow(
  buffer: LinkRowSource,
  bufferLineNumber: number,
): string {
  return buffer.getLine(bufferLineNumber - 1)?.translateToString(true) ?? "";
}

export function createTerminalLinkHandler(focus: () => void) {
  return {
    activate: (_event: MouseEvent, uri: string) =>
      void openExternalUrl(uri, focus),
  };
}
