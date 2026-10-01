type LatestRendererOptions = {
  render: (source: string) => Promise<string>;
  onSuccess: (svg: string, revision: number) => void;
  onError: (error: unknown, revision: number) => void;
};

export function createLatestMermaidRenderer({
  render,
  onSuccess,
  onError,
}: LatestRendererOptions) {
  let revision = 0;
  let active = false;
  let pending: { source: string; revision: number } | null = null;
  let drainPromise: Promise<void> = Promise.resolve();

  const drain = async (): Promise<void> => {
    if (active) return drainPromise;
    active = true;
    drainPromise = (async () => {
      while (pending) {
        const job = pending;
        pending = null;
        try {
          const svg = await render(job.source);
          if (job.revision === revision) onSuccess(svg, job.revision);
        } catch (error) {
          if (job.revision === revision) onError(error, job.revision);
        }
      }
    })().finally(() => {
      active = false;
    });
    return drainPromise;
  };

  return {
    run(source: string): Promise<void> {
      pending = { source, revision: ++revision };
      return drain();
    },
    invalidate(): void {
      revision += 1;
      pending = null;
    },
  };
}
