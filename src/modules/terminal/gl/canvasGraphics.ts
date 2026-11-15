import type {
  DecodedGraphics,
  GraphicImage,
} from "@/modules/terminal/gl/graphicsCodec";
import { RenderCapacityError } from "@/modules/terminal/gl/renderCapacity";

const MAX_BYTES = 128 * 1024 * 1024;
type Image = {
  id: number;
  width: number;
  height: number;
  canvas: HTMLCanvasElement;
};
type State = {
  frame: Omit<DecodedGraphics, "images">;
  images: Map<string, Image>;
  bytes: number;
};
export class CanvasGraphics {
  private panes = new Map<object, State>();
  private bytes = 0;
  private crop: HTMLCanvasElement | null = null;
  private cropContext: CanvasRenderingContext2D | null = null;
  apply(pane: object, frame: DecodedGraphics | undefined): void {
    if (!frame?.placements.length) {
      this.remove(pane);
      return;
    }
    const previous = this.panes.get(pane);
    const uploads = new Map(frame.images.map((image) => [image.key, image]));
    const refs = new Map<string, Image | GraphicImage>();
    let bytes = 0;
    for (const placement of frame.placements) {
      const image =
        uploads.get(placement.key) ?? previous?.images.get(placement.key);
      if (!image || image.id !== placement.id)
        throw new Error("missing native graphic image");
      const old = previous?.images.get(placement.key);
      if (
        old &&
        (old.id !== image.id ||
          old.width !== image.width ||
          old.height !== image.height)
      )
        throw new Error("native graphic generation reused");
      if (
        placement.sourceX + placement.sourceWidth > image.width + 0.001 ||
        placement.sourceY + placement.sourceHeight > image.height + 0.001
      )
        throw new Error("invalid native graphic crop");
      if (!refs.has(placement.key)) {
        bytes += image.width * image.height * 4;
        refs.set(placement.key, old ?? image);
      }
    }
    if (this.bytes - (previous?.bytes ?? 0) + bytes > MAX_BYTES)
      throw new RenderCapacityError();
    if (
      !this.crop &&
      frame.placements.some((p) => {
        const image = refs.get(p.key);
        return (
          image &&
          (p.sourceX !== 0 ||
            p.sourceY !== 0 ||
            p.sourceWidth !== image.width ||
            p.sourceHeight !== image.height)
        );
      })
    ) {
      const crop = document.createElement("canvas");
      const context = crop.getContext("2d");
      if (!context) throw new RenderCapacityError();
      this.crop = crop;
      this.cropContext = context;
    }
    const images = new Map<string, Image>();
    try {
      for (const [key, image] of refs) {
        if ("canvas" in image) {
          images.set(key, image);
          continue;
        }
        const canvas = document.createElement("canvas");
        images.set(key, {
          id: image.id,
          width: image.width,
          height: image.height,
          canvas,
        });
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext("2d");
        if (!context) {
          canvas.width = canvas.height = 0;
          throw new RenderCapacityError();
        }
        context.putImageData(
          new ImageData(
            new Uint8ClampedArray(image.pixels),
            image.width,
            image.height,
          ),
          0,
          0,
        );
      }
    } catch (error) {
      for (const [key, image] of images)
        if (image !== previous?.images.get(key))
          image.canvas.width = image.canvas.height = 0;
      throw error instanceof RenderCapacityError
        ? error
        : new RenderCapacityError();
    }
    for (const [key, image] of previous?.images ?? [])
      if (image !== images.get(key))
        image.canvas.width = image.canvas.height = 0;
    this.bytes += bytes - (previous?.bytes ?? 0);
    this.panes.set(pane, {
      frame: {
        cellWidth: frame.cellWidth,
        cellHeight: frame.cellHeight,
        placements: frame.placements,
      },
      images,
      bytes,
    });
  }
  has(pane: object): boolean {
    return this.panes.has(pane);
  }
  draw(
    ctx: CanvasRenderingContext2D,
    pane: object,
    layer: 0 | 1 | 2,
    cw: number,
    ch: number,
  ): void {
    const state = this.panes.get(pane);
    if (!state) return;
    const f = state.frame;
    for (const p of f.placements) {
      const z = p.z < -1073741824 ? 0 : p.z < 0 ? 1 : 2;
      if (z !== layer) continue;
      const image = state.images.get(p.key);
      if (!image) continue;
      let source = image.canvas;
      if (
        p.sourceX !== 0 ||
        p.sourceY !== 0 ||
        p.sourceWidth !== image.width ||
        p.sourceHeight !== image.height
      ) {
        if (!this.crop || !this.cropContext) continue;
        const cropWidth = Math.max(1, Math.ceil(p.sourceWidth));
        const cropHeight = Math.max(1, Math.ceil(p.sourceHeight));
        if (this.crop.width !== cropWidth || this.crop.height !== cropHeight) {
          this.crop.width = 0;
          this.crop.height = 0;
          this.crop.width = cropWidth;
          this.crop.height = cropHeight;
        }
        const context = this.cropContext;
        context.clearRect(0, 0, cropWidth, cropHeight);
        context.drawImage(
          source,
          p.sourceX,
          p.sourceY,
          p.sourceWidth,
          p.sourceHeight,
          0,
          0,
          cropWidth,
          cropHeight,
        );
        source = this.crop;
      }
      ctx.drawImage(
        source,
        0,
        0,
        source.width,
        source.height,
        (p.col + p.offsetX / f.cellWidth) * cw,
        (p.row + p.offsetY / f.cellHeight) * ch,
        (p.width / f.cellWidth) * cw,
        (p.height / f.cellHeight) * ch,
      );
    }
  }
  remove(pane: object): void {
    const old = this.panes.get(pane);
    if (!old) return;
    this.bytes -= old.bytes;
    for (const image of old.images.values())
      image.canvas.width = image.canvas.height = 0;
    this.panes.delete(pane);
    if (this.panes.size === 0 && this.crop) {
      this.crop.width = this.crop.height = 0;
      this.crop = null;
      this.cropContext = null;
    }
  }
  dispose(): void {
    for (const pane of this.panes.keys()) this.remove(pane);
    if (this.crop) this.crop.width = this.crop.height = 0;
    this.crop = null;
    this.cropContext = null;
  }
}
