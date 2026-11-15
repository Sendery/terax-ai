export const RENDER_CAPACITY_MESSAGE =
  "Terminal view exceeds render capacity. Reduce visible panes and redraw.";

export class RenderCapacityError extends Error {
  constructor() {
    super(RENDER_CAPACITY_MESSAGE);
    this.name = "RenderCapacityError";
  }
}
