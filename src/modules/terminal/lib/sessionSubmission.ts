export type TerminalSubmission = {
  submitWhenReady: (
    text: string,
    timeoutMs: number,
    current?: () => boolean,
  ) => Promise<boolean>;
};

export function createTerminalSubmission(target: {
  current: () => boolean;
  ready: () => boolean;
  wait: (timeoutMs: number) => Promise<void>;
  submit: (text: string, current: () => boolean) => void | Promise<void>;
}): TerminalSubmission {
  let attempted = false;
  return {
    async submitWhenReady(text, timeoutMs, current = () => true) {
      if (attempted || !target.current() || !current()) return false;
      attempted = true;
      try {
        await target.wait(timeoutMs);
        if (!target.current() || !current() || !target.ready()) return false;
        await target.submit(
          text,
          () => target.current() && current() && target.ready(),
        );
        return target.current() && current();
      } catch {
        return false;
      }
    },
  };
}
