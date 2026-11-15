import type { EngineSession } from "./engineSession";
import { NativeBlockProjection } from "./nativeBlocks";
import type { NativeBlockInput } from "./nativeBlockInput";
import type { BlockUiMatch } from "@/modules/terminal/block/lib/blockSearchController";
type Options = {
  session: Pick<
    EngineSession,
    "drawnSeq" | "blocks" | "readBlock" | "blockAction"
  >;
  input?: NativeBlockInput | null;
  available: () => boolean;
  metrics: () => { height: number; padding: number };
  onError: (error: unknown) => void;
};
export class NativeBlockView {
  private readonly projection: NativeBlockProjection;
  private disposed = false;
  private readonly subscriptions = new Set<() => void>();
  constructor(private readonly options: Options) {
    this.projection = new NativeBlockProjection({
      request: (seq) => options.session.blocks(seq),
      presented: () => (this.available() ? options.session.drawnSeq : null),
      metrics: options.metrics,
      onError: options.onError,
    });
  }
  private available(): boolean {
    return !this.disposed && this.options.available();
  }
  private requireAvailable(): void {
    if (!this.available())
      throw new Error("Block output is no longer available.");
  }
  subscribe = (listener: () => void): (() => void) => {
    if (this.disposed) return () => {};
    const changed = () => {
      if (!this.disposed) listener();
    };
    const projection = this.projection.subscribe(changed);
    const input = this.options.input?.subscribe(changed);
    const stop = () => {
      projection();
      input?.();
      this.subscriptions.delete(stop);
    };
    this.subscriptions.add(stop);
    return stop;
  };
  visible = () => this.projection.visible();
  present(seq: number | null): void {
    const drawn = seq ?? this.options.session.drawnSeq;
    if (!this.available() || drawn === null) this.projection.layout();
    else this.projection.present(drawn);
  }
  layout(): void {
    this.projection.layout();
  }
  readOutput = async (id: string): Promise<string | null> => {
    this.requireAvailable();
    const result = await this.options.session.readBlock(id);
    this.requireAvailable();
    return result?.output ?? null;
  };
  searchBlock = async (id: string, query: string): Promise<BlockUiMatch[]> => {
    this.requireAvailable();
    const reply = await this.options.session.blockAction({
      kind: "find",
      blockId: id,
      query,
    });
    this.requireAvailable();
    if (reply.kind !== "matches")
      throw new Error("Invalid block search reply.");
    return reply.matches.map((match) => ({
      line: match.line,
      col: match.col,
      len: match.len,
      native: { version: reply.version, index: match.index },
    }));
  };
  revealMatch = async (match: BlockUiMatch): Promise<boolean> => {
    this.requireAvailable();
    if (!match.native) return false;
    const reply = await this.options.session.blockAction({
      kind: "reveal",
      ...match.native,
    });
    this.requireAvailable();
    if (reply.kind !== "revealed")
      throw new Error("Invalid block reveal reply.");
    return reply.found;
  };
  // Cleanup remains bound to its original process, even after the view hides.
  clearSearch = async (): Promise<void> => {
    await this.options.session.blockAction({ kind: "clearSearch" });
  };
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const stop of [...this.subscriptions]) stop();
    this.projection.dispose();
  }
}
