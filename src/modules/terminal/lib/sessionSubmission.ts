export type TerminalSubmission = {
  submitWhenReady: (
    text: string,
    timeoutMs: number,
    current?: () => boolean,
    onWriteAttempt?: () => void,
  ) => Promise<boolean>;
};

export function createTerminalSubmission(target: {
  current: () => boolean;
  ready: () => boolean;
  wait: (timeoutMs: number) => Promise<void>;
  submit: (
    text: string,
    current: () => boolean,
    onWriteAttempt?: () => void,
  ) => void | Promise<void>;
}): TerminalSubmission {
  let attempted = false;
  return {
    async submitWhenReady(
      text,
      timeoutMs,
      current = () => true,
      onWriteAttempt,
    ) {
      if (attempted || !target.current() || !current()) return false;
      attempted = true;
      try {
        await target.wait(timeoutMs);
        if (!target.current() || !current() || !target.ready()) return false;
        await target.submit(
          text,
          () => target.current() && current() && target.ready(),
          onWriteAttempt,
        );
        return target.current() && current();
      } catch {
        return false;
      }
    },
  };
}
