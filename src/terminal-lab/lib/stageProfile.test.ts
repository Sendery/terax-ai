import { expect, it } from "vitest";
import { StageProfile } from "@/terminal-lab/lib/stageProfile";

it("correlates local stages by session/sequence and keeps CPU submission separate", () => {
  const profile = new StageProfile();
  profile.frame(0, { seq: 1, decodeMs: 2, applyMs: 3, readyAt: 10 });
  profile.drawn(0, 1, 30);
  profile.credit(0, 1, 31);
  expect(profile.pendingReplies).toBe(1);
  profile.reply(0, 1, 34, true);
  profile.render(29, 4, 12);
  profile.stop(35);
  const report = profile.toJSON();
  expect(report.frames).toEqual([[0, 1, 2, 3, 10, 30, 31, 34, true, 0]]);
  expect(report.draws).toEqual([[29, 4, 12]]);
  expect(report.decodeMs.p50).toBe(2);
  expect(report.applyMs.p50).toBe(3);
  expect(report.readyToDrawMs.p50).toBe(20);
  expect(report.creditCommandMs.p50).toBe(3);
  expect(report.drawSubmissionMs.p50).toBe(4);
  expect(report.complete).toBe(true);
  expect(profile.pendingReplies).toBe(0);
});
it("coalesced frames keep null draw timestamps and late replies do not extend drawing", () => {
  const p = new StageProfile();
  p.frame(0, { seq: 1, decodeMs: 0, applyMs: 0, readyAt: 5 });
  p.frame(0, { seq: 2, decodeMs: 0, applyMs: 0, readyAt: 7 });
  p.drawn(0, 2, 10);
  p.credit(0, 1, 11);
  p.credit(0, 2, 11);
  p.stop(12);
  expect(p.toJSON().complete).toBe(false);
  p.render(13, 9, 12);
  p.reply(0, 1, 14, true);
  p.reply(0, 2, 14, true);
  const r = p.toJSON();
  expect(r.draws).toEqual([]);
  expect(r.frames[0][5]).toBeNull();
  expect(r.readyToDrawMs.count).toBe(1);
  expect(r.readyToDrawMs.p50).toBe(3);
  expect(r.creditCommandMs.count).toBe(2);
  expect(r.complete).toBe(true);
});
it("records failed replies and invalid observations without throwing out of Channel", () => {
  const p = new StageProfile();
  expect(() =>
    p.frame(0, { seq: 0, decodeMs: 0, applyMs: 0, readyAt: 0 }),
  ).not.toThrow();
  p.frame(0, { seq: 1, decodeMs: 0, applyMs: 0, readyAt: 2 });
  p.credit(0, 1, 3);
  p.reply(0, 1, 4, false);
  p.reply(99, 1, 5, true);
  p.stop(6);
  const r = p.toJSON();
  expect(r.complete).toBe(false);
  expect(r.failedReplies).toBe(1);
  expect(r.errors.length).toBeGreaterThan(0);
  expect(r.frames[0][8]).toBe(false);
});
it("cannot declare a final profile complete while a received frame has no dispatched credit", () => {
  const p = new StageProfile();
  p.frame(0, { seq: 1, decodeMs: 0, applyMs: 0, readyAt: 0 });
  p.drawn(0, 1, 1);
  p.stop(2);
  expect(p.toJSON().missingCredits).toBe(1);
  expect(p.toJSON().complete).toBe(false);
});

it("keeps whole-envelope validation wait separate from decode and apply CPU durations", () => {
  const p = new StageProfile();
  p.frame(0, {
    seq: 1,
    decodeMs: 2,
    applyMs: 3,
    validationWaitMs: 7,
    readyAt: 20,
  });
  p.credit(0, 1, 21);
  p.reply(0, 1, 22, true);
  const r = p.toJSON();
  expect(r.frameColumns[9]).toBe("validationWaitMs");
  expect(r.frames[0][9]).toBe(7);
  expect(r.validationWaitMs.p50).toBe(7);
  expect(r.decodeMs.p50).toBe(2);
  expect(r.applyMs.p50).toBe(3);
});
