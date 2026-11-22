export type TerminalSearchOptions = { incremental?: boolean };
export interface TerminalSearch {
  findNext(
    query: string,
    options?: TerminalSearchOptions,
  ): boolean | Promise<boolean>;
  findPrevious(
    query: string,
    options?: TerminalSearchOptions,
  ): boolean | Promise<boolean>;
  clearDecorations(): void | Promise<void>;
}
