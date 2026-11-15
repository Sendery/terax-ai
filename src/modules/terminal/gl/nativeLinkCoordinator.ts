import { isLinkActivation } from "@/modules/terminal/lib/pointer";
import type { TerminalFileLocation } from "@/modules/terminal/lib/fileLinks";
import {
  resolveNativeLink,
  type NativeLinkContext,
  type NativeLinkSource,
  type ResolvedNativeLink,
} from "@/modules/terminal/gl/nativeLinks";

export type NativeLinkPoint = { seq: number; col: number; row: number };
type Origin = { key: string; source: NativeLinkSource };
type Options = {
  lookup: (point: NativeLinkPoint) => Promise<NativeLinkContext | null>;
  origin: () => Origin;
  active: () => boolean;
  available?: () => boolean;
  presentedSeq: () => number | null;
  paint: (link: ResolvedNativeLink | null) => void;
  openFile: (path: string, location?: TerminalFileLocation) => void;
  openUrl: (uri: string) => Promise<void>;
  focus: () => void;
  isMac: boolean;
};
export class NativeLinkCoordinator {
  private epoch = 0;
  private hoverVersion = 0;
  private disposed = false;
  private hoverContext: NativeLinkContext | null = null;
  private hoverLink: ResolvedNativeLink | null = null;
  private hoverKey: string | null = null;
  private down: {
    point: NativeLinkPoint;
    origin: Origin;
    epoch: number;
    context: Promise<NativeLinkContext | null>;
  } | null = null;
  constructor(private readonly options: Options) {}
  get context(): NativeLinkContext | null {
    return this.hoverContext;
  }
  private current(key: string, epoch: number, requireActive = false): boolean {
    return (
      !this.disposed &&
      (this.options.available?.() ?? this.options.active()) &&
      (!requireActive || this.options.active()) &&
      epoch === this.epoch &&
      this.options.origin().key === key
    );
  }
  invalidateHover(): void {
    this.hoverVersion++;
    this.hoverContext = null;
    this.hoverLink = null;
    this.hoverKey = null;
    this.options.paint(null);
  }
  invalidate(): void {
    this.epoch++;
    this.down = null;
    this.invalidateHover();
  }
  dispose(): void {
    this.disposed = true;
    this.invalidate();
  }
  async hover(point: NativeLinkPoint): Promise<ResolvedNativeLink | null> {
    if (this.disposed || !(this.options.available?.() ?? this.options.active()))
      return null;
    const origin = this.options.origin();
    const epoch = this.epoch;
    if (
      this.hoverContext?.seq === point.seq &&
      this.hoverKey === origin.key &&
      this.hoverLink?.ranges.some(
        (range) =>
          range.row === point.row &&
          range.start <= point.col &&
          point.col < range.end,
      )
    )
      return this.hoverLink;
    this.invalidateHover();
    const version = this.hoverVersion;
    try {
      const context = await this.options.lookup(point);
      if (
        !context ||
        !this.current(origin.key, epoch) ||
        version !== this.hoverVersion
      )
        return null;
      const link = await resolveNativeLink(context, origin.source);
      if (
        !this.current(origin.key, epoch) ||
        version !== this.hoverVersion ||
        this.options.presentedSeq() !== point.seq
      )
        return null;
      this.hoverContext = context;
      this.hoverLink = link;
      this.hoverKey = origin.key;
      this.options.paint(link);
      return link;
    } catch {
      return null;
    }
  }
  begin(point: NativeLinkPoint): void {
    if (this.disposed || !(this.options.available?.() ?? this.options.active()))
      return;
    const origin = this.options.origin();
    const cached =
      this.hoverContext?.seq === point.seq &&
      this.hoverKey === origin.key &&
      this.hoverLink?.ranges.some(
        (range) =>
          range.row === point.row &&
          range.start <= point.col &&
          point.col < range.end,
      )
        ? this.hoverContext
        : null;
    const context = cached
      ? Promise.resolve(cached)
      : Promise.resolve()
          .then(() => this.options.lookup(point))
          .catch(() => null);
    this.down = { point: { ...point }, origin, epoch: this.epoch, context };
  }
  async end(
    point: NativeLinkPoint,
    event: Pick<MouseEvent, "button" | "ctrlKey">,
    dragged: boolean,
  ): Promise<boolean> {
    const down = this.down;
    this.down = null;
    if (
      !down ||
      dragged ||
      !isLinkActivation(event, this.options.isMac) ||
      down.point.col !== point.col ||
      down.point.row !== point.row ||
      !this.current(down.origin.key, down.epoch, true)
    )
      return false;
    try {
      const context = await down.context;
      if (!context || !this.current(down.origin.key, down.epoch, true))
        return false;
      const link = await resolveNativeLink(context, down.origin.source);
      if (!link || !this.current(down.origin.key, down.epoch, true))
        return false;
      if (link.target.kind === "file")
        this.options.openFile(link.target.path, link.target.location);
      else {
        await this.options.openUrl(link.target.url);
        if (this.current(down.origin.key, down.epoch, true))
          this.options.focus();
      }
      return true;
    } catch {
      return false;
    }
  }
}
