import type { UIMessage } from "ai";
import { beforeEach, expect, it, vi } from "vitest";

const reader = vi.hoisted(() => ({
  open: vi.fn(async ({ text }: { text: string }) => ({ id: text })),
  prepare: vi.fn(async (_id: string, _current: () => boolean) => {}),
  enabled: false,
}));

vi.mock("@/modules/reader/lib/player", () => ({
  openStored: reader.open,
  prepareReaderAudio: reader.prepare,
}));
vi.mock("@/modules/settings/preferences", () => ({
  usePreferencesStore: { getState: () => ({ prepareChatAudio: reader.enabled }) },
}));

import { queueResponseAudio, responseText } from "@/modules/ai/lib/responseAudio";

beforeEach(() => {
  vi.clearAllMocks();
  reader.enabled = false;
});

it("prepares only visible assistant text and only when opted in", async () => {
  const message: UIMessage = {
    id: "reply", role: "assistant",
    parts: [
      { type: "reasoning", text: "Internal reasoning" },
      { type: "text", text: "First paragraph." },
      { type: "text", text: "Second paragraph." },
    ],
  };
  const text = responseText(message);
  expect(text).toBe("First paragraph.\n\nSecond paragraph.");
  expect(responseText({ ...message, role: "user" })).toBe("");
  queueResponseAudio(text);
  await Promise.resolve();
  expect(reader.open).not.toHaveBeenCalled();

  reader.enabled = true;
  queueResponseAudio(text);
  await vi.waitFor(() => expect(reader.prepare).toHaveBeenCalledWith(text, expect.any(Function)));
  expect(reader.open).toHaveBeenCalledWith({ text });
  const current = reader.prepare.mock.calls[0][1];
  expect(current()).toBe(true);
  reader.enabled = false;
  expect(current()).toBe(false);
});
