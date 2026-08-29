export type StateMirror<T> = {
  /** Latest value, including commits React has not rendered yet. */
  read: () => T;
  /** Apply a mutation and return the new value synchronously. */
  commit: (next: (current: T) => T) => T;
  /** Adopt a value that React has committed, ignoring stale replays. */
  sync: (committed: T) => void;
};

/**
 * A synchronous mirror of a piece of React state.
 *
 * Handlers driven from outside React, such as the Pi command bridge, run a
 * mutation and a read in the same tick. React state is not updated until the
 * next render, so those reads miss the write: `tasks.add` returns an id that
 * `tasks.update` then reports as unknown. The mirror holds the authoritative
 * value between the mutation and the render.
 *
 * `sync` deliberately ignores a value it has already seen, so an unrelated
 * re-render that replays the pre-commit state cannot roll the mirror back.
 */
export function createStateMirror<T>(initial: T): StateMirror<T> {
  let value = initial;
  let lastSynced = initial;

  return {
    read: () => value,
    commit(next) {
      value = next(value);
      return value;
    },
    sync(committed) {
      if (committed === lastSynced) return;
      lastSynced = committed;
      value = committed;
    },
  };
}
