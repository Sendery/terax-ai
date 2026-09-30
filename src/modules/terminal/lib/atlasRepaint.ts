export type RepaintTarget = { readonly hasWebgl: boolean };

// A renderer attached during the repaint uploads every atlas page into a new
// context, so only a target that kept an older context can hold stale textures.
export function needsAtlasClear(targets: Iterable<RepaintTarget>): boolean {
  for (const target of targets) {
    if (target.hasWebgl) return true;
  }
  return false;
}
