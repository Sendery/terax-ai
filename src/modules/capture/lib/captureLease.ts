export type CaptureScope = {
  signal: AbortSignal;
  current: () => boolean;
};
export type NativeCaptureLease = {
  root: HTMLElement;
  canvas: HTMLCanvasElement;
  snapshot: string;
  excluded: readonly Element[];
  foreground?: HTMLElement;
  current: () => boolean;
  dispose: () => void;
};
type Provider = (scope: CaptureScope) => Promise<NativeCaptureLease>;
const providers = new WeakMap<HTMLElement, Provider>();
const preparing = new WeakSet<HTMLElement>();

function cancellation(signal: AbortSignal): Error {
  return signal.reason instanceof Error && signal.reason.name !== "AbortError"
    ? signal.reason
    : new Error("Capture was cancelled.");
}

export function assertCaptureCurrent(scope: CaptureScope): void {
  if (scope.signal.aborted) throw cancellation(scope.signal);
  if (!scope.current()) throw new Error("Capture is no longer available.");
}

/** One deadline signal covers all awaits, including late resource cleanup. */
export function duringCapture<T>(
  work: PromiseLike<T>,
  scope: CaptureScope,
  discard?: (value: T) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => scope.signal.removeEventListener("abort", abort);
    const abort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(cancellation(scope.signal));
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const discardValue = (value: T) => {
      try {
        discard?.(value);
      } catch (error) {
        if (!settled) fail(error);
        else console.error("Capture resource cleanup failed", error);
      }
    };
    scope.signal.addEventListener("abort", abort, { once: true });
    // Attach handlers even if entry validation fails: work may already own a
    // resource or finish after cancellation, and must never be left unobserved.
    Promise.resolve(work).then((value) => {
      if (settled) {
        discardValue(value);
        return;
      }
      try {
        assertCaptureCurrent(scope);
      } catch (error) {
        discardValue(value);
        fail(error);
        return;
      }
      settled = true;
      cleanup();
      resolve(value);
    }, fail);
    try {
      assertCaptureCurrent(scope);
    } catch (error) {
      fail(error);
    }
  });
}

export function registerNativeCaptureProvider(
  root: HTMLElement,
  provider: Provider,
): () => void {
  providers.set(root, provider);
  return () => {
    if (providers.get(root) === provider) providers.delete(root);
  };
}

export async function prepareNativeCapture(
  root: HTMLElement,
  scope: CaptureScope,
): Promise<NativeCaptureLease> {
  assertCaptureCurrent(scope);
  const provider = providers.get(root);
  if (!provider) throw new Error("Native terminal capture is unavailable.");
  if (preparing.has(root))
    throw new Error("Terminal capture is already in progress.");
  preparing.add(root);
  const live = () =>
    root.isConnected &&
    preparing.has(root) &&
    providers.get(root) === provider &&
    scope.current();
  let lease: NativeCaptureLease | null = null;
  try {
    lease = await duringCapture(
      provider({ signal: scope.signal, current: live }),
      { signal: scope.signal, current: live },
      (late) => late.dispose(),
    );
    if (lease.root !== root || !lease.current())
      throw new Error("Native terminal capture is no longer available.");
    const prepared = lease;
    let disposed = false;
    return {
      root,
      canvas: prepared.canvas,
      snapshot: prepared.snapshot,
      excluded: prepared.excluded,
      foreground: prepared.foreground,
      current: () =>
        !disposed && !scope.signal.aborted && live() && prepared.current(),
      dispose: () => {
        if (disposed) return;
        disposed = true;
        preparing.delete(root);
        prepared.dispose();
      },
    };
  } catch (error) {
    preparing.delete(root);
    lease?.dispose();
    throw error;
  }
}
