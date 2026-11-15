import { expect, it, vi } from "vitest";
import { routeAgentNotification } from "@/modules/agents/lib/route";

const h = vi.hoisted(() => ({
  post: vi.fn(async () => true),
  fallback: vi.fn(),
  record: vi.fn(),
  badge: vi.fn<() => Promise<null>>(),
}));
vi.mock("@/modules/ai/lib/native", () => ({ native: { agentNotify: h.post } }));
vi.mock("@/modules/settings/preferences", () => ({
  usePreferencesStore: { getState: () => ({ agentNotifications: true }) },
}));
vi.mock("@/modules/agents/store/agentStore", () => ({
  useAgentStore: { getState: () => ({ pushNotification: h.record }) },
}));
vi.mock("@/modules/agents/lib/notificationBadge", () => ({
  agentBadgePng: h.badge,
}));
vi.mock("@/modules/agents/lib/notify", () => ({ osNotify: h.fallback }));
vi.mock("@/modules/tabs", () => ({ TAB_COLOR_CSS: {} }));

it("revalidates the public owner after preparing a notification badge", async () => {
  let current = true;
  let resolve!: (value: null) => void;
  h.badge.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  routeAgentNotification({
    source: "terminal",
    agent: "terminal",
    kind: "attention",
    title: "Build finished",
    tone: "attention",
    focused: false,
    visible: false,
    leafId: 9001,
    current: () => current,
  });
  expect(h.record).toHaveBeenCalledOnce();
  current = false;
  resolve(null);
  await Promise.resolve();
  await Promise.resolve();
  expect(h.post).not.toHaveBeenCalled();
  expect(h.fallback).not.toHaveBeenCalled();
  h.record.mockClear();
  routeAgentNotification({
    source: "terminal",
    agent: "terminal",
    kind: "attention",
    title: "Private",
    tone: "attention",
    focused: false,
    visible: false,
    leafId: 9002,
    current: () => false,
  });
  expect(h.record).not.toHaveBeenCalled();
});
