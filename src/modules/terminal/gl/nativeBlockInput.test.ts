import { expect, it, vi } from "vitest";
import { NativeBlockInput } from "@/modules/terminal/gl/nativeBlockInput";
import type { NativeState } from "@/modules/terminal/gl/nativeState";

const state = (patch: Partial<NativeState> = {}): NativeState => ({
  version: 1,
  alternateScreen: false,
  mouseTracking: false,
  bracketedPaste: true,
  focusTracking: false,
  modifyOtherKeys: 0,
  kittyFlags: 0,
  cwd: "/workspace",
  shellReady: true,
  commandRunning: false,
  blocksEnabled: true,
  blocksMetadataVersion: 0,
  promptVersion: 1,
  ...patch,
});
it("waits for real block-shell readiness and hands input to running or alternate programs", () => {
  const input = new NativeBlockInput();
  const changed = vi.fn();
  input.subscribe(changed);
  expect(input.mode).toBe("running");
  input.accept(state({ version: 0, shellReady: false }));
  expect(changed).not.toHaveBeenCalled();
  input.accept(state());
  expect(input.mode).toBe("prompt");
  input.accept(
    state({ version: 2, commandRunning: true, blocksMetadataVersion: 1 }),
  );
  expect(input.mode).toBe("running");
  input.accept(
    state({ version: 3, alternateScreen: true, commandRunning: true }),
  );
  expect(input.mode).toBe("alt");
  input.accept(state({ version: 4, commandRunning: true }));
  expect(input.mode).toBe("running");
  input.accept(state({ version: 5 }));
  expect(input.mode).toBe("prompt");
  expect(changed).toHaveBeenCalledTimes(5);
});
it("retains independent full drafts through process reset and releases them only on disposal", () => {
  const first = new NativeBlockInput();
  const second = new NativeBlockInput();
  const draft = "printf 'naïve 界'\n".concat("x".repeat(10000));
  first.draft = draft;
  second.draft = "other";
  first.accept(state());
  first.reset();
  expect(first.draft).toBe(draft);
  expect(first.mode).toBe("running");
  expect(second.draft).toBe("other");
  first.dispose();
  expect(first.draft).toBe("");
  first.draft = "late cleanup";
  expect(first.draft).toBe("");
});
it("keeps the submit-to-marker gap busy and ignores unrelated or stale state changes", () => {
  const input = new NativeBlockInput();
  input.accept(state({ blocksMetadataVersion: 4 }));
  const ticket = input.beginSubmit();
  expect(input.mode).toBe("running");
  expect(() => input.beginSubmit()).toThrow("ready");
  input.accept(
    state({ version: 2, cwd: "/workspace/other", blocksMetadataVersion: 4 }),
  );
  expect(input.mode).toBe("running");
  input.accept(
    state({ version: 3, commandRunning: true, blocksMetadataVersion: 5 }),
  );
  expect(input.mode).toBe("running");
  input.accept(state({ version: 2, blocksMetadataVersion: 6 }));
  expect(input.mode).toBe("running");
  input.accept(state({ version: 4, blocksMetadataVersion: 6 }));
  expect(input.mode).toBe("prompt");
  input.rejectSubmit(ticket);
  expect(input.mode).toBe("prompt");
});
it("also finishes a command whose C and D were delivered together", () => {
  const input = new NativeBlockInput();
  input.accept(state());
  input.beginSubmit();
  input.accept(state({ version: 2, blocksMetadataVersion: 2 }));
  expect(input.mode).toBe("prompt");
});
it("recovers a rejected submission without accepting a late rejection from an old process", () => {
  const input = new NativeBlockInput();
  input.accept(state());
  const old = input.beginSubmit();
  input.reset();
  input.accept(state());
  const next = input.beginSubmit();
  input.rejectSubmit(old);
  expect(input.mode).toBe("running");
  input.rejectSubmit(next);
  expect(input.mode).toBe("prompt");
});
it("binds editor focus to the current attachment and never steals it while a program runs", () => {
  const input = new NativeBlockInput();
  const first = vi.fn();
  const second = vi.fn();
  const cleanup = input.bindFocus(first, () => true);
  expect(input.focus()).toBe(false);
  input.accept(state());
  expect(input.focus()).toBe(true);
  expect(first).toHaveBeenCalledOnce();
  input.bindFocus(second, () => true);
  cleanup();
  expect(input.focus()).toBe(true);
  expect(second).toHaveBeenCalledOnce();
  expect(input.focused).toBe(true);
  input.accept(state({ version: 2, commandRunning: true }));
  expect(input.focus()).toBe(false);
  expect(input.focused).toBe(false);
  input.dispose();
  input.accept(state({ version: 3 }));
  expect(input.focus()).toBe(false);
});
it("does not mistake disabled native blocks for a usable shell editor", () => {
  const input = new NativeBlockInput();
  input.accept(state({ blocksEnabled: false }));
  expect(input.mode).toBe("running");
  expect(() => input.beginSubmit()).toThrow("ready");
});

it("finishes an accepted comment when a new authenticated prompt arrives without C/D metadata", () => {
  const input = new NativeBlockInput();
  input.accept(state());
  input.beginSubmit();
  input.accept(state({ version: 2, promptVersion: 2 }));
  expect(input.mode).toBe("prompt");
});

it("settles the accepted owner's draft while an identical draft belongs to another leaf", () => {
  const first = new NativeBlockInput();
  const second = new NativeBlockInput();
  first.draft = "same command";
  second.draft = "same command";
  first.accept(state());
  const ticket = first.beginSubmit("same command");
  const changed = vi.fn();
  const detach = first.subscribeDraft(changed);
  first.accept(state({ version: 2, blocksMetadataVersion: 2 }));
  first.acceptSubmit(ticket);
  expect(first.draft).toBe("");
  expect(second.draft).toBe("same command");
  expect(changed).toHaveBeenCalledOnce();
  detach();
});
it("never clears an edited owner draft even when its text later becomes identical", () => {
  const input = new NativeBlockInput();
  input.draft = "same command";
  input.accept(state());
  const ticket = input.beginSubmit("same command");
  input.draft = "edited";
  input.draft = "same command";
  input.acceptSubmit(ticket);
  expect(input.draft).toBe("same command");
});

it("distinguishes a submission gap from a running program even when both modes are running", () => {
  const input = new NativeBlockInput();
  input.accept(state());
  input.beginSubmit();
  expect(input.directInput).toBe(false);
  const changed = vi.fn();
  input.subscribe(changed);
  input.accept(
    state({ version: 2, commandRunning: true, blocksMetadataVersion: 1 }),
  );
  expect(input.mode).toBe("running");
  expect(input.directInput).toBe(true);
  expect(changed).toHaveBeenCalledOnce();
});

it("announces initial hints only for a ready empty native block grid and never over real content", () => {
  const input = new NativeBlockInput();
  expect(input.watermark).toBe("hidden");
  input.accept(state());
  expect(input.watermark).toBe("visible");
  const changed = vi.fn();
  input.subscribe(changed);
  input.draft = "draft";
  expect(input.watermark).toBe("hidden");
  input.draft = "";
  expect(input.watermark).toBe("visible");
  input.markContent();
  expect(input.watermark).toBe("dead");
  expect(changed).toHaveBeenCalledTimes(3);
  input.reset();
  input.accept(state());
  expect(input.watermark).toBe("dead");
});
