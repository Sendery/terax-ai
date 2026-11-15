import type { BlockMatch } from "./blockDecorations";
export type BlockUiMatch = BlockMatch & {
  native?: { version: number; index: number };
};
export type Awaitable<T> = T | Promise<T>;
export type BlockReveal =
  | ((match: BlockUiMatch) => Awaitable<boolean>)
  | ((match: BlockUiMatch) => Awaitable<void>);
export type BlockSearchState = {
  matches: BlockUiMatch[];
  index: number;
  pending: boolean;
  error: string | null;
};
type Options = {
  searchBlock: (query: string) => Awaitable<BlockUiMatch[]>;
  revealMatch: BlockReveal;
  clearSearch: () => Awaitable<void>;
  onChange: () => void;
};
const empty = (): BlockSearchState => ({
  matches: [],
  index: 0,
  pending: false,
  error: null,
});
export class BlockSearchController {
  state = empty();
  private revision = 0;
  private pending: { query: string; revision: number } | null = null;
  private busy = false;
  private disposed = false;
  constructor(private readonly options: Options) {}
  private publish(state: BlockSearchState): void {
    if (this.disposed) return;
    this.state = state;
    this.options.onChange();
  }
  find(query: string): void {
    if (this.disposed) return;
    this.pending = { query, revision: ++this.revision };
    this.publish({ ...empty(), pending: true });
    void this.drain();
  }
  private async drain(): Promise<void> {
    if (this.busy || this.disposed) return;
    this.busy = true;
    try {
      while (this.pending && !this.disposed) {
        const { query, revision } = this.pending;
        this.pending = null;
        try {
          const matches = await this.options.searchBlock(query);
          if (this.disposed || revision !== this.revision) continue;
          if (
            matches.length &&
            (await this.options.revealMatch(matches[0])) === false
          )
            throw new Error("Block output is no longer available.");
          if (!this.disposed && revision === this.revision)
            this.publish({ matches, index: 0, pending: false, error: null });
        } catch {
          if (!this.disposed && revision === this.revision)
            this.publish({
              ...empty(),
              error: "Block search is no longer available.",
            });
        }
      }
    } finally {
      this.busy = false;
    }
  }
  async navigate(direction: -1 | 1): Promise<void> {
    if (this.disposed || this.state.pending || !this.state.matches.length)
      return;
    const revision = this.revision;
    const index =
      (this.state.index + direction + this.state.matches.length) %
      this.state.matches.length;
    const matches = this.state.matches;
    this.publish({ ...this.state, pending: true });
    try {
      if ((await this.options.revealMatch(matches[index])) === false)
        throw new Error("Block output is no longer available.");
      if (!this.disposed && revision === this.revision)
        this.publish({ matches, index, pending: false, error: null });
    } catch {
      if (!this.disposed && revision === this.revision)
        this.publish({
          ...empty(),
          error: "Block search is no longer available.",
        });
    }
  }
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.revision++;
    this.pending = null;
    await this.options.clearSearch();
  }
}
export async function readAvailableBlockOutput(
  read: (id: string) => Awaitable<string | null>,
  id: string,
  current: () => boolean,
): Promise<string> {
  if (!current()) throw new Error("Block output is no longer available.");
  const output = await read(id);
  if (!current() || output === null)
    throw new Error("Block output is no longer available.");
  return output;
}
