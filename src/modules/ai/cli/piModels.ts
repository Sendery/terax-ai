import { create } from "zustand";
import { allocateSpawnId, readPiDefaults, runCliAgent } from "./bridge";
import {
  parsePiModelList,
  type PiDefaults,
  type PiModelEntry,
} from "./pi";

type PiModelsState = {
  status: "idle" | "loading" | "ready" | "error";
  models: PiModelEntry[];
  defaults: PiDefaults | null;
  error: string | null;
};

export const usePiModelsStore = create<PiModelsState>(() => ({
  status: "idle",
  models: [],
  defaults: null,
  error: null,
}));

let inflight: Promise<void> | null = null;

/**
 * Ask Pi which models it can use (those with credentials) and which one it
 * starts with. Runs on demand only, when the Pi model list is shown, and is
 * cached for the session: listing spawns Pi, which is not free.
 */
export function loadPiModels(force = false): Promise<void> {
  const { status } = usePiModelsStore.getState();
  if (inflight) return inflight;
  if (!force && (status === "ready" || status === "loading")) {
    return Promise.resolve();
  }
  usePiModelsStore.setState({ status: "loading", error: null });
  const lines: string[] = [];
  const stderr: string[] = [];
  inflight = Promise.all([
    readPiDefaults(),
    runCliAgent(
      { id: allocateSpawnId(), argv: ["pi", "--list-models"], cwd: null },
      {
        onStdout: (line) => lines.push(line),
        onStderr: (line) => stderr.push(line),
      },
    ),
  ])
    .then(([defaults, { code }]) => {
      const models = parsePiModelList(lines);
      if (code !== 0 && models.length === 0) {
        throw new Error(stderr[stderr.length - 1]?.trim() || `pi exited with code ${code}`);
      }
      usePiModelsStore.setState({
        status: "ready",
        models,
        defaults: defaults ?? null,
        error: null,
      });
    })
    .catch((e: unknown) => {
      usePiModelsStore.setState({
        status: "error",
        error: e instanceof Error ? e.message : String(e),
      });
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
