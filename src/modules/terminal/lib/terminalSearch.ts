import type { ISearchOptions } from "@xterm/addon-search";

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
export const TERMINAL_SEARCH_DECORATIONS = {
  matchBackground: "#515c6a",
  activeMatchBackground: "#d18616",
  matchOverviewRuler: "#d18616",
  activeMatchColorOverviewRuler: "#d18616",
};
type DecoratedSearch = {
  findNext(query: string, options?: ISearchOptions): boolean;
  findPrevious(query: string, options?: ISearchOptions): boolean;
  clearDecorations(): void;
};
const adapters = new WeakMap<DecoratedSearch, TerminalSearch>();
export function decorateTerminalSearch(addon: DecoratedSearch): TerminalSearch {
  let adapter = adapters.get(addon);
  if (!adapter) {
    adapter = {
      findNext: (query, options) =>
        addon.findNext(query, {
          ...options,
          decorations: TERMINAL_SEARCH_DECORATIONS,
        }),
      findPrevious: (query, options) =>
        addon.findPrevious(query, {
          ...options,
          decorations: TERMINAL_SEARCH_DECORATIONS,
        }),
      clearDecorations: () => addon.clearDecorations(),
    };
    adapters.set(addon, adapter);
  }
  return adapter;
}
