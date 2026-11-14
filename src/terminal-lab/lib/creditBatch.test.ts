import { expect, it, vi } from "vitest";
import { LabCreditBatcher } from "@/terminal-lab/lib/creditBatch";

function setup(
  send = vi.fn(async (_acks: { id: number; seq: number }[]) => {}),
) {
  const tasks: (() => void)[] = [];
  let now = 0;
  const batch = new LabCreditBatcher(
    send,
    (task) => tasks.push(task),
    () => now,
  );
  return {
    batch,
    send,
    tasks,
    time: (value: number) => {
      now = value;
    },
  };
}

it("dispatches twelve distinct acknowledgements in one microtask without another rAF", async () => {
  const t = setup();
  const pending = Array.from({ length: 12 }, (_, i) => t.batch.send(i + 1, 7));
  expect(t.send).not.toHaveBeenCalled();
  expect(t.tasks).toHaveLength(1);
  t.time(2);
  t.tasks[0]();
  await Promise.all(pending);
  expect(t.send).toHaveBeenCalledTimes(1);
  expect(t.send).toHaveBeenCalledWith(
    Array.from({ length: 12 }, (_, i) => ({ id: i + 1, seq: 7 })),
  );
  expect(t.batch.snapshot()).toMatchObject({
    complete: true,
    invocations: 1,
    queued: 12,
    registered: 12,
    pending: 0,
    maxPending: 12,
    dispatchDelayMs: { count: 12, total: 24, max: 2 },
  });
});

it("preserves multiple sequences of one session in ordered separate batches", async () => {
  const t = setup();
  const pending = [t.batch.send(1, 1), t.batch.send(1, 2), t.batch.send(2, 8)];
  t.tasks[0]();
  await Promise.all(pending);
  expect(t.send.mock.calls).toEqual([
    [[{ id: 1, seq: 1 }]],
    [
      [
        { id: 1, seq: 2 },
        { id: 2, seq: 8 },
      ],
    ],
  ]);
});

it("propagates a batch rejection to every member and reports failure", async () => {
  const failure = new Error("native registration failed");
  const t = setup(
    vi.fn(async () => {
      throw failure;
    }),
  );
  const pending = [t.batch.send(1, 1), t.batch.send(2, 1)];
  const settled = Promise.allSettled(pending);
  t.tasks[0]();
  expect((await settled).map((result) => result.status)).toEqual([
    "rejected",
    "rejected",
  ]);
  expect(t.batch.snapshot()).toMatchObject({
    complete: false,
    failed: 2,
    pending: 0,
  });
});

it("bounds queued and in-flight acknowledgements together without discarding an accepted pair", async () => {
  let finish = () => {};
  const t = setup(
    vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    ),
  );
  const pending = Array.from({ length: 48 }, (_, i) => t.batch.send(i + 1, 1));
  t.tasks[0]();
  const overflow = t.batch.send(49, 1);
  await expect(overflow).rejects.toThrow("48");
  expect(t.batch.snapshot()).toMatchObject({
    pending: 48,
    rejected: 1,
    complete: false,
  });
  t.batch.close();
  await Promise.allSettled(pending);
  finish();
});

it("rejects duplicate outstanding pairs and invalid u32 values", async () => {
  const t = setup();
  const first = t.batch.send(1, 2);
  await expect(t.batch.send(1, 2)).rejects.toThrow("duplicate");
  for (const [id, seq] of [
    [0, 1],
    [1, 0],
    [-1, 1],
    [1, 0x100000000],
    [1.5, 1],
  ])
    await expect(t.batch.send(id, seq)).rejects.toThrow("u32");
  t.tasks[0]();
  await first;
  expect(t.send).toHaveBeenCalledWith([{ id: 1, seq: 2 }]);
  expect(t.batch.snapshot().complete).toBe(false);
});

it("closing rejects queued and in-flight work, suppresses later dispatch and remains idempotent", async () => {
  let finish = () => {};
  const t = setup(
    vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    ),
  );
  const first = t.batch.send(1, 1);
  const settledFirst = Promise.allSettled([first]);
  t.tasks[0]();
  const second = t.batch.send(2, 1);
  const settledSecond = Promise.allSettled([second]);
  t.batch.close();
  t.batch.close();
  t.tasks[1]();
  finish();
  expect((await settledFirst)[0].status).toBe("rejected");
  expect((await settledSecond)[0].status).toBe("rejected");
  expect(t.send).toHaveBeenCalledTimes(1);
  expect(t.batch.snapshot()).toMatchObject({
    pending: 0,
    failed: 2,
    complete: false,
  });
  await expect(t.batch.send(3, 1)).rejects.toThrow("closed");
});

it("records draw-to-dispatch delay separately when an id became available after drawing", async () => {
  const t = setup();
  t.time(10);
  const pending = t.batch.send(1, 1, 0);
  t.time(12);
  t.tasks[0]();
  await pending;
  expect(t.batch.snapshot()).toMatchObject({
    dispatchDelayMs: { total: 2 },
    drawToDispatchMs: { count: 1, total: 12, min: 12, max: 12 },
  });
});

it("a rejection with no error value is still a failed registration", async () => {
  const t = setup(vi.fn(() => Promise.reject()));
  const pending = t.batch.send(1, 1);
  const settled = Promise.allSettled([pending]);
  t.tasks[0]();
  expect((await settled)[0].status).toBe("rejected");
  expect(t.batch.snapshot()).toMatchObject({
    complete: false,
    registered: 0,
    failed: 1,
  });
});

it("marks every sequence dispatched just before IPC, never when it is merely queued", async () => {
  const order: string[] = [];
  const t = setup(
    vi.fn(async () => {
      order.push("invoke");
    }),
  );
  const onDispatch = vi.fn((at: number) => {
    order.push(`sent ${at}`);
  });
  const pending = t.batch.send(1, 1, 0, onDispatch);
  expect(onDispatch).not.toHaveBeenCalled();
  t.time(5);
  t.tasks[0]();
  await pending;
  expect(onDispatch).toHaveBeenCalledWith(5);
  expect(order).toEqual(["sent 5", "invoke"]);
});

it("a throwing dispatch observer rejects the whole batch before native registration", async () => {
  const t = setup();
  const failure = new Error("dispatch observer failed");
  const settled = Promise.allSettled([
    t.batch.send(1, 1, 0, () => {
      throw failure;
    }),
    t.batch.send(2, 1),
  ]);
  t.tasks[0]();
  expect((await settled).every((item) => item.status === "rejected")).toBe(
    true,
  );
  expect(t.send).not.toHaveBeenCalled();
  expect(t.batch.snapshot()).toMatchObject({
    complete: false,
    invocations: 0,
    registered: 0,
    failed: 2,
    pending: 0,
  });
});

it("separate window-local senders never mix queues or lifecycle", async () => {
  const first = setup();
  const second = setup();
  const one = Promise.allSettled([first.batch.send(1, 1)]);
  const two = second.batch.send(2, 1);
  first.batch.close();
  first.tasks[0]();
  second.tasks[0]();
  expect((await one)[0].status).toBe("rejected");
  await two;
  expect(first.send).not.toHaveBeenCalled();
  expect(second.send).toHaveBeenCalledExactlyOnceWith([{ id: 2, seq: 1 }]);
  expect(second.batch.snapshot().complete).toBe(true);
});


it("calls the default browser scheduler with its global receiver", async () => {
  const tasks: (() => void)[] = [];
  const send = vi.fn(async () => {});
  vi.stubGlobal("queueMicrotask", function (this: unknown, task: () => void) {
    if (this !== globalThis) throw new TypeError("invalid browser receiver");
    tasks.push(task);
  });
  const batch = new LabCreditBatcher(send);
  try {
    const pending = batch.send(1, 1);
    const settled = Promise.allSettled([pending]);
    expect(tasks).toHaveLength(1);
    tasks[0]();
    expect((await settled)[0].status).toBe("fulfilled");
    expect(send).toHaveBeenCalledWith([{ id: 1, seq: 1 }]);
    expect(batch.snapshot()).toMatchObject({ complete: true, pending: 0 });
  } finally {
    batch.close();
    vi.unstubAllGlobals();
  }
});

it("closes and clears pending work if scheduling throws, including a retained callback", async () => {
  const failure = new Error("scheduler failed");
  let late = () => {};
  const send = vi.fn(async () => {});
  const schedule = vi.fn((task: () => void) => {
    late = task;
    throw failure;
  });
  const batch = new LabCreditBatcher(send, schedule);
  await expect(batch.send(1, 1)).rejects.toBe(failure);
  expect(batch.snapshot()).toMatchObject({
    complete: false,
    pending: 0,
    queued: 1,
    failed: 1,
    registered: 0,
    invocations: 0,
  });
  late();
  await expect(batch.send(2, 1)).rejects.toThrow("closed");
  batch.close();
  expect(schedule).toHaveBeenCalledTimes(1);
  expect(send).not.toHaveBeenCalled();
  expect(batch.snapshot()).toMatchObject({ failed: 1, rejected: 1, pending: 0 });
});
