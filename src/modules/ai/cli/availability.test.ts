import { beforeEach, expect, it, vi } from "vitest";
const detect = vi.hoisted(() => vi.fn());
vi.mock("@/modules/ai/cli/bridge", () => ({ detectCliAgents: detect }));
import {
  cliProviderInstalled,
  hasInstalledCli,
  providerAvailableInPicker,
  refreshCliAvailability,
  useCliAvailabilityStore,
} from "./availability";
import { CLI_BINARIES } from "./binaries";
import { CLI_AGENTS } from "./registry";

beforeEach(() => {
  detect.mockReset();
  useCliAvailabilityStore.setState({ paths: {}, status: "idle" });
});
it("shares the runner's exact binaries without treating another keyless provider as CLI", () => {
  for (const [id, def] of Object.entries(CLI_AGENTS))
    expect(CLI_BINARIES[id as keyof typeof CLI_BINARIES]).toBe(def.bin);
  const paths = {
    codex: "/fixture/codex",
    "cursor-agent": "/fixture/cursor-agent",
  };
  expect(hasInstalledCli(paths)).toBe(true);
  expect(cliProviderInstalled("cli-codex", paths)).toBe(true);
  expect(cliProviderInstalled("cli-cursor", paths)).toBe(true);
  expect(cliProviderInstalled("cli-claude", paths)).toBe(false);
  expect(cliProviderInstalled("ollama", paths)).toBe(false);
  expect(
    hasInstalledCli({
      codex: null,
      claude: "  ",
      unknown: "/fixture/unrelated",
    }),
  ).toBe(false);
});
it("marks missing CLI models unavailable while preserving existing non-CLI policy", () => {
  expect(providerAvailableInPicker("cli-codex", {}, {})).toBe(false);
  expect(
    providerAvailableInPicker("cli-codex", {}, { codex: "/fixture/codex" }),
  ).toBe(true);
  expect(providerAvailableInPicker("openai", {}, {})).toBe(false);
  expect(
    providerAvailableInPicker("openai", { openai: "public-test-key" }, {}),
  ).toBe(true);
  expect(providerAvailableInPicker("ollama", {}, {})).toBe(true);
  expect(providerAvailableInPicker("chatgpt-codex", {}, {})).toBe(true);
});
it("deduplicates concurrent bootstrap, Settings and StrictMode requests", async () => {
  let resolve!: (paths: Record<string, string | null>) => void;
  detect.mockReturnValueOnce(
    new Promise((r) => {
      resolve = r;
    }),
  );
  const a = refreshCliAvailability(),
    b = refreshCliAvailability(),
    c = refreshCliAvailability();
  expect(a).toBe(b);
  expect(b).toBe(c);
  await Promise.resolve();
  expect(detect).toHaveBeenCalledExactlyOnceWith(Object.values(CLI_BINARIES));
  expect(useCliAvailabilityStore.getState().status).toBe("loading");
  resolve({ codex: "/fixture/codex", claude: null });
  await a;
  expect(useCliAvailabilityStore.getState()).toMatchObject({
    status: "ready",
    paths: { codex: "/fixture/codex", claude: null },
  });
});
it("fails closed without an unhandled rejection and permits explicit retry", async () => {
  detect.mockRejectedValueOnce(new Error("IPC unavailable"));
  await refreshCliAvailability();
  expect(useCliAvailabilityStore.getState()).toMatchObject({
    status: "error",
    paths: {},
  });
  detect.mockResolvedValueOnce({ claude: "/fixture/claude" });
  await refreshCliAvailability();
  expect(hasInstalledCli(useCliAvailabilityStore.getState().paths)).toBe(true);
  expect(detect).toHaveBeenCalledTimes(2);
});
it("publishes no late UI update to an unmounted observer and refreshes removal", async () => {
  let resolve!: (paths: Record<string, string | null>) => void;
  detect.mockReturnValueOnce(
    new Promise((r) => {
      resolve = r;
    }),
  );
  const notify = vi.fn();
  const unsubscribe = useCliAvailabilityStore.subscribe(notify);
  const request = refreshCliAvailability();
  await Promise.resolve();
  unsubscribe();
  notify.mockClear();
  resolve({ codex: "/fixture/codex" });
  await request;
  expect(notify).not.toHaveBeenCalled();
  detect.mockResolvedValueOnce({ codex: null });
  await refreshCliAvailability();
  expect(hasInstalledCli(useCliAvailabilityStore.getState().paths)).toBe(false);
});

it("does not lose an explicit invalidation while an older scan is pending", async () => {
  let first!: (paths: Record<string, string | null>) => void;
  let second!: (paths: Record<string, string | null>) => void;
  detect.mockReturnValueOnce(
    new Promise((resolve) => {
      first = resolve;
    }),
  );
  detect.mockReturnValueOnce(
    new Promise((resolve) => {
      second = resolve;
    }),
  );
  const pending = refreshCliAvailability();
  await Promise.resolve();
  expect(refreshCliAvailability({ invalidate: true })).toBe(pending);
  first({ codex: null });
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  expect(detect).toHaveBeenCalledTimes(2);
  expect(useCliAvailabilityStore.getState().status).toBe("loading");
  second({ codex: "/fixture/new-codex" });
  await pending;
  expect(
    cliProviderInstalled("cli-codex", useCliAvailabilityStore.getState().paths),
  ).toBe(true);
});

it("joins a reentrant loading observer after installing the pending request", async () => {
  detect.mockResolvedValueOnce({ codex: null });
  let joined: Promise<void> | undefined;
  const unsubscribe = useCliAvailabilityStore.subscribe((state) => {
    if (state.status === "loading") joined = refreshCliAvailability();
  });
  const request = refreshCliAvailability();
  expect(joined).toBe(request);
  await request;
  unsubscribe();
  expect(detect).toHaveBeenCalledTimes(1);
});
