import { beforeEach, expect, it, vi } from "vitest";
const { runBench } = vi.hoisted(() => ({ runBench: vi.fn() }));
vi.mock("@/terminal-lab/lib/bench", () => ({ runBench }));
import { runEngineGate } from "@/terminal-lab/lib/gate";
import type { LabReport } from "@/terminal-lab/lib/report";
import type { RendererFont } from "@/modules/terminal/gl/gridRenderer";
import type { LabColors } from "@/terminal-lab/lib/useLabAppearance";

beforeEach(() => runBench.mockReset());
const plan = () => ({
  stage: {} as HTMLElement,
  font: {} as RendererFont,
  colors: {} as LabColors,
  onProgress: vi.fn(),
});
const report = () =>
  ({ bench: [], errors: [], finishedAt: null }) as unknown as LabReport;
it("pre-registers all three unchanged generators at 1024 MiB for twelve full grids", async () => {
  runBench.mockResolvedValue({
    rust: Array(12).fill({}),
    timedOut: false,
    decodeErrors: 0,
  });
  const p = plan();
  const r = report();
  await runEngineGate(p, r);
  expect(runBench.mock.calls.map((args) => args.slice(3))).toEqual([
    ["ascii", 12, 1024],
    ["sgr", 12, 1024],
    ["tui", 12, 1024],
  ]);
  expect(r.bench).toHaveLength(3);
  expect(r.errors).toEqual([]);
  expect(r.finishedAt).not.toBeNull();
  expect(p.onProgress).toHaveBeenLastCalledWith(r, "done");
});
it("retains failures and later measurements without changing workloads", async () => {
  runBench.mockRejectedValueOnce(new Error("GPU failed"));
  runBench.mockResolvedValueOnce({
    error: "draw failed",
    timedOut: true,
    decodeErrors: 2,
    rust: [null],
  });
  runBench.mockResolvedValueOnce({
    rust: [],
    timedOut: false,
    decodeErrors: 0,
  });
  const r = report();
  await runEngineGate(plan(), r);
  expect(runBench).toHaveBeenCalledTimes(3);
  expect(r.bench).toHaveLength(2);
  expect(r.errors.join(";")).toContain("GPU failed");
  expect(r.errors.join(";")).toContain("draw failed");
  expect(r.errors.join(";")).toContain("timed out");
  expect(r.errors.join(";")).toContain("decode");
  expect(r.errors.join(";")).toContain("statistics missing");
});
it("profiles the same three payloads without changing their fixed workload", async () => {
  runBench.mockResolvedValue({
    rust: Array(12).fill({}),
    timedOut: false,
    decodeErrors: 0,
  });
  await runEngineGate(plan(), report(), { profile: true });
  expect(runBench.mock.calls.map((args) => args.slice(3))).toEqual([
    ["ascii", 12, 1024, { profile: true }],
    ["sgr", 12, 1024, { profile: true }],
    ["tui", 12, 1024, { profile: true }],
  ]);
});
