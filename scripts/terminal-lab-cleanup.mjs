export function sameProcess(a, b) {
  return Boolean(a?.birth && b?.birth && a.pid === b.pid && a.birth === b.birth);
}

export function observeDescendants(all, owned) {
  const live = new Map(all.filter((p) => sameProcess(p, owned.get(p.pid))).map((p) => [p.pid, p]));
  for (let changed = true; changed;) {
    changed = false;
    for (const p of all) {
      if (p.birth && live.has(p.ppid) && !live.has(p.pid)) {
        live.set(p.pid, p);
        changed = true;
      }
    }
  }
  for (const p of live.values()) owned.set(p.pid, p);
  return [...live.values()];
}

/** Every signal targets a fresh kernel birth-identity match, never a process name or shared group. */
export async function cleanupOwned(owned, { snapshot, signal, sleep, now = Date.now }, termMs = 5000, killMs = 3000) {
  const sent = [];
  const errors = [];
  const initial = [...owned.values()];
  for (const [kind, duration] of [["SIGTERM", termMs], ["SIGKILL", killMs]]) {
    const deadline = now() + duration;
    const signalled = new Set();
    do {
      const live = observeDescendants(snapshot(), owned);
      if (!live.length) return { initial, sent, errors, survivors: [] };
      for (const p of live.reverse()) {
        const key = `${p.pid}:${p.birth}`;
        if (signalled.has(key)) continue;
        // A PID may disappear and be reused between polling and signalling.
        const current = snapshot().find((candidate) => candidate.pid === p.pid);
        if (!sameProcess(p, current)) continue;
        try { signal(p.pid, kind); sent.push({ pid: p.pid, birth: p.birth, command: current.command, signal: kind }); }
        catch (error) { if (error.code !== "ESRCH") errors.push({ pid: p.pid, signal: kind, error: String(error) }); }
        signalled.add(key);
      }
      await sleep(100);
    } while (now() < deadline);
  }
  return { initial, sent, errors, survivors: observeDescendants(snapshot(), owned) };
}
