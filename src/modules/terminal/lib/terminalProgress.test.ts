import { expect, it } from "vitest";
import {
  terminalProgressValue,
  useTerminalProgress,
} from "@/modules/terminal/lib/terminalProgress";

it("rejects malformed progress and treats indeterminate mode as no percentage", () => {
  expect(terminalProgressValue(5, { state: 3, percent: 50 })).toEqual({
    ptyId: 5,
    state: 3,
    percent: null,
  });
  for (const value of [
    { state: 5, percent: 1 },
    { state: 1, percent: 101 },
    { state: 1, percent: 1.5 },
  ])
    expect(terminalProgressValue(5, value)).toBeNull();
});
it("does not let a retired process clear the current pane progress", () => {
  useTerminalProgress.setState({ values: {} });
  const store = useTerminalProgress.getState();
  store.update(7, 10, { state: 1, percent: 20 });
  store.update(7, 11, { state: 1, percent: 40 });
  store.update(7, 10, { state: 0, percent: null });
  expect(useTerminalProgress.getState().values[7].percent).toBe(40);
  store.retain(new Set());
  expect(useTerminalProgress.getState().values).toEqual({});
});
