import { create } from "zustand";

export type TerminalProgressValue = {
  ptyId: number;
  state: 1 | 2 | 3 | 4;
  percent: number | null;
};

export function terminalProgressValue(
  ptyId: number,
  value: { state: number; percent: number | null } | null | undefined,
): TerminalProgressValue | null {
  if (
    !value ||
    !Number.isInteger(value.state) ||
    value.state < 1 ||
    value.state > 4
  )
    return null;
  const percent = value.percent;
  if (
    percent !== null &&
    (!Number.isInteger(percent) || percent < 0 || percent > 100)
  )
    return null;
  return {
    ptyId,
    state: value.state as 1 | 2 | 3 | 4,
    percent: value.state === 3 ? null : percent,
  };
}

export const useTerminalProgress = create<{
  values: Record<number, TerminalProgressValue>;
  update: (
    leafId: number,
    ptyId: number,
    progress: { state: number; percent: number | null },
  ) => void;
  retain: (leafIds: ReadonlySet<number>) => void;
}>((set) => ({
  values: {},
  update: (leafId, ptyId, progress) =>
    set((state) => {
      const value = terminalProgressValue(ptyId, progress);
      const previous = state.values[leafId];
      if (!value) {
        if (progress.state !== 0) return state;
        if (!previous || previous.ptyId !== ptyId) return state;
        const values = { ...state.values };
        delete values[leafId];
        return { values };
      }
      if (
        previous?.ptyId === ptyId &&
        previous.state === value.state &&
        previous.percent === value.percent
      )
        return state;
      if (!previous && Object.keys(state.values).length >= 256) return state;
      return { values: { ...state.values, [leafId]: value } };
    }),
  retain: (leafIds) =>
    set((state) => {
      const entries = Object.entries(state.values);
      if (entries.every(([id]) => leafIds.has(Number(id)))) return state;
      return {
        values: Object.fromEntries(
          entries.filter(([id]) => leafIds.has(Number(id))),
        ),
      };
    }),
}));
