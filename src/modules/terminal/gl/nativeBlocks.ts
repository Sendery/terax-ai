import type { BlockMeta } from "@/modules/terminal/block/lib/types";
import type {
  BlockContext,
  PositionedBlock,
  VisibleBlocks,
} from "@/modules/terminal/block/lib/blockDecorations";

export type NativeBlockSnapshot = {
  seq: number | null;
  metadataVersion: number;
  hasAny: boolean;
  alternateScreen: boolean;
  viewportOffset: number;
  viewportRows: number;
  blocks: (BlockMeta & { running: boolean })[];
};
const encoder = new TextEncoder();
function invalid(): never {
  throw new Error("invalid native terminal blocks reply");
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return invalid();
  return value as Record<string, unknown>;
}
function integer(value: unknown, max = Number.MAX_SAFE_INTEGER): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > max
  )
    return invalid();
  return value;
}
function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") return invalid();
  return value;
}
function text(value: unknown, limit: number): string {
  if (
    typeof value !== "string" ||
    value.length > limit ||
    encoder.encode(value).byteLength > limit
  )
    return invalid();
  return value;
}
function command(value: unknown): string {
  const result = text(value, 4096);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(result))
    return invalid();
  return result;
}
function cwd(value: unknown): string {
  const result = text(value, 128 * 1024);
  if (
    result &&
    (!/^(?:\/|[A-Za-z]:[\\/])/.test(result) ||
      /[\u0000-\u001f\u007f-\u009f]/.test(result))
  )
    return invalid();
  return result;
}
function exitCode(value: unknown): number | null {
  if (value === null) return null;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < -0x80000000 ||
    value > 0x7fffffff
  )
    return invalid();
  return value;
}
export function validateNativeBlockId(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    !/^b[1-9][0-9]{0,19}$/.test(value) ||
    BigInt(value.slice(1)) > 0xffffffffffffffffn
  )
    return invalid();
}
export function decodeNativeBlocks(
  value: unknown,
  seq: number,
): NativeBlockSnapshot {
  const data = object(value);
  if (integer(data.seq, 0xffffffff) !== seq || seq < 1) return invalid();
  const raw = data.blocks;
  if (!Array.isArray(raw) || raw.length > 1001) return invalid();
  const ids = new Set<string>();
  let bytes = 0;
  const blocks = raw.map((value) => {
    const block = object(value);
    validateNativeBlockId(block.id);
    if (ids.has(block.id)) return invalid();
    ids.add(block.id);
    const startLine = integer(block.startLine, 0xffffffff);
    const endLine = integer(block.endLine, 0xffffffff);
    if (endLine < startLine) return invalid();
    const cmd = command(block.command);
    const path = cwd(block.cwd);
    bytes +=
      encoder.encode(cmd).byteLength +
      encoder.encode(path).byteLength +
      block.id.length;
    if (bytes > 5 * 1024 * 1024) return invalid();
    return {
      id: block.id,
      command: cmd,
      cwd: path,
      exitCode: exitCode(block.exitCode),
      running: boolean(block.running),
      startLine,
      endLine,
      startedAt: integer(block.startedAt),
      finishedAt: integer(block.finishedAt),
    };
  });
  const viewportRows = integer(data.viewportRows, 500);
  if (viewportRows < 1) return invalid();
  return {
    seq,
    metadataVersion: integer(data.metadataVersion),
    hasAny: boolean(data.hasAny),
    alternateScreen: boolean(data.alternateScreen),
    viewportOffset: integer(data.viewportOffset),
    viewportRows,
    blocks,
  };
}
export function decodeNativeBlockOutput(value: unknown): BlockContext | null {
  if (value === null) return null;
  const data = object(value);
  return {
    command: command(data.command),
    cwd: cwd(data.cwd),
    exitCode: exitCode(data.exitCode),
    output: text(data.output, 1024 * 1024),
  };
}
function empty(): VisibleBlocks {
  return { blocks: [], sticky: null };
}
export function projectNativeBlocks(
  snapshot: NativeBlockSnapshot,
  height: number,
  padding = 6,
): VisibleBlocks {
  if (
    snapshot.alternateScreen ||
    !Number.isFinite(height) ||
    height <= 0 ||
    !Number.isFinite(padding)
  )
    return empty();
  const result = empty();
  for (const block of snapshot.blocks) {
    if (
      block.endLine < snapshot.viewportOffset ||
      block.startLine >= snapshot.viewportOffset + snapshot.viewportRows
    )
      continue;
    const top = padding + (block.startLine - snapshot.viewportOffset) * height;
    const positioned: PositionedBlock = {
      id: block.id,
      command: block.command,
      cwd: block.cwd,
      exitCode: block.exitCode,
      running: block.running,
      ok: block.exitCode === null || block.exitCode === 0,
      startedAt: block.startedAt,
      finishedAt: block.finishedAt,
      top,
      bottom: padding + (block.endLine - snapshot.viewportOffset + 1) * height,
      headerTop: top - 1.9 * height,
    };
    result.blocks.push(positioned);
    if (block.startLine < snapshot.viewportOffset) result.sticky = positioned;
  }
  return result;
}
type ProjectionOptions = {
  request: (seq: number) => Promise<NativeBlockSnapshot | null>;
  presented: () => number | null;
  metrics: () => { height: number; padding: number };
  onError?: (error: unknown) => void;
};
export class NativeBlockProjection {
  private snapshot: NativeBlockSnapshot | null = null;
  private view = empty();
  private pending: number | null = null;
  private busy = false;
  private disposed = false;
  private readonly listeners = new Set<() => void>();
  constructor(private readonly options: ProjectionOptions) {}
  subscribe = (listener: () => void): (() => void) => {
    if (this.disposed) return () => {};
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  visible = (): VisibleBlocks => this.view;
  present(seq: number): void {
    if (this.disposed || this.options.presented() !== seq) return;
    if (this.snapshot?.seq === seq) {
      this.layout();
      return;
    }
    this.snapshot = null;
    this.layout();
    this.pending = seq;
    void this.drain();
  }
  layout(): void {
    const metrics = this.options.metrics();
    this.view =
      !this.disposed && this.snapshot?.seq === this.options.presented()
        ? projectNativeBlocks(this.snapshot, metrics.height, metrics.padding)
        : empty();
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch {
        console.error("native block projection observer failed");
      }
    }
  }
  dispose(): void {
    this.disposed = true;
    this.pending = null;
    this.snapshot = null;
    this.view = empty();
    this.listeners.clear();
  }
  private async drain(): Promise<void> {
    if (this.busy || this.disposed) return;
    this.busy = true;
    try {
      while (this.pending !== null && !this.disposed) {
        const seq = this.pending;
        this.pending = null;
        try {
          const snapshot = await this.options.request(seq);
          if (this.disposed) return;
          if (this.options.presented() === seq) {
            this.snapshot = snapshot;
            this.layout();
          }
        } catch (error) {
          if (!this.disposed && this.options.presented() === seq) {
            this.snapshot = null;
            this.layout();
            try {
              this.options.onError?.(error);
            } catch {
              console.error("native block projection error observer failed");
            }
          }
        }
      }
    } finally {
      this.busy = false;
    }
  }
}
