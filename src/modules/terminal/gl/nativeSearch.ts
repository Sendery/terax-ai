import type {
  TerminalSearch,
  TerminalSearchOptions,
} from "@/modules/terminal/lib/terminalSearch";

export type NativeSearchCommand =
  | { kind: "find"; query: string; forward: boolean; incremental: boolean }
  | { kind: "clear" };
type Request = {
  command: NativeSearchCommand;
  resolve: (found: boolean) => void;
  reject: (error: unknown) => void;
};
export function validateSearchCommand(command: NativeSearchCommand): void {
  if (
    command.kind === "find" &&
    (new TextEncoder().encode(command.query).byteLength > 4096 ||
      /[\u0000-\u001f\u007f-\u009f]/.test(command.query))
  )
    throw new Error(
      "Terminal search requires at most 4096 UTF-8 bytes without controls.",
    );
}
export function createNativeSearch(
  send: (command: NativeSearchCommand) => Promise<boolean>,
): TerminalSearch {
  const pending: Request[] = [];
  let draining = false;
  const drain = async () => {
    if (draining) return;
    draining = true;
    while (pending.length) {
      const request = pending.shift()!;
      try {
        request.resolve(await send(request.command));
      } catch (error) {
        request.reject(error);
      }
    }
    draining = false;
  };
  const submit = (command: NativeSearchCommand) =>
    new Promise<boolean>((resolve, reject) => {
      validateSearchCommand(command);
      const last = pending[pending.length - 1];
      if (
        command.kind === "find" &&
        command.incremental &&
        last?.command.kind === "find" &&
        last.command.incremental
      ) {
        pending.pop()!.resolve(false);
      }
      if (pending.length >= 31) {
        reject(new Error("Too many pending terminal searches."));
        return;
      }
      pending.push({ command, resolve, reject });
      void drain();
    });
  const find = (
    query: string,
    forward: boolean,
    options?: TerminalSearchOptions,
  ) =>
    submit({
      kind: "find",
      query,
      forward,
      incremental: options?.incremental ?? false,
    });
  return {
    findNext: (query, options) => find(query, true, options),
    findPrevious: (query, options) => find(query, false, options),
    clearDecorations: () => submit({ kind: "clear" }).then(() => {}),
  };
}
