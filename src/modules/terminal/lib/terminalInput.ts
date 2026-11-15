export type TerminalInput = {
  current: () => boolean;
  cwd: () => string | null;
  isReady: () => boolean;
  write: (text: string, current?: () => boolean) => Promise<void>;
  shiftEnter: () => Promise<string>;
  readBuffer: (
    maxLines: number,
    current?: () => boolean,
  ) => Promise<string | null>;
};
