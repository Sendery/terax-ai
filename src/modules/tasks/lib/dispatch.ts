import type { ScheduledTask } from "./task";

export type ShellFlavor = "posix" | "windows";

const SAFE_ARG = /^[A-Za-z0-9_@%+=:,./-]+$/;

function stamp(now: number): string {
  const date = new Date(now);
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "T",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}

/**
 * Session a run should target. A `task` keeps one session so context
 * accumulates; a `routine` mints a fresh timestamped session every run, so no
 * prior context leaks in.
 */
export function sessionIdFor(task: ScheduledTask, now: number): string {
  if (task.mode === "routine") return `terax-${task.id}-${stamp(now)}`;
  return task.sessions[0]?.id ?? `terax-${task.id}`;
}

/**
 * argv for one run. An interactive launch deliberately omits the prompt: it is
 * typed into the session afterwards so multiline prompts survive.
 */
export function buildPiArgv(
  task: ScheduledTask,
  sessionId: string,
  options: { headless: boolean },
): string[] {
  const argv = ["pi"];
  if (options.headless) argv.push("--print");
  if (task.provider) argv.push("--provider", task.provider);
  if (task.model) argv.push("--model", task.model);
  if (task.thinking) argv.push("--thinking", task.thinking);
  argv.push("--session-id", sessionId);
  if (options.headless) argv.push(task.prompt);
  return argv;
}

function quotePosix(arg: string): string {
  if (arg !== "" && SAFE_ARG.test(arg)) return arg;
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

function quoteWindows(arg: string): string {
  if (arg !== "" && SAFE_ARG.test(arg)) return arg;
  return `'${arg.replace(/'/g, "''")}'`;
}

export function formatCommandLine(
  argv: readonly string[],
  flavor: ShellFlavor,
): string {
  const quote = flavor === "windows" ? quoteWindows : quotePosix;
  return argv.map(quote).join(" ");
}

/** Enter, sent on its own write to submit a prompt already in the composer.
 *  `handOffPrompt` owns when it is sent and how it is confirmed. */
export const SUBMIT_KEY = "\r";

/**
 * Keystrokes that type a prompt into a running pi session, without submitting.
 *
 * Two rules are load bearing. A raw newline would submit the prompt truncated at
 * the first line break, so line breaks are sent as the Shift+Enter sequence the
 * terminal negotiated with the foreground program. And the submitting Enter must
 * be a separate, later write: a TUI reading one burst that ends in a carriage
 * return treats the whole thing as a paste and leaves it unsent.
 */
export function promptKeystrokes(
  prompt: string,
  shiftEnterSequence: string,
): string {
  if (prompt.trim() === "") return "";
  const lines = prompt.replace(/\r\n?/g, "\n").split("\n");
  return lines.join(shiftEnterSequence);
}

const ANSI = /\[[0-9;?]*[a-zA-Z]|\][^]*(?:|\\)/g;
const SUMMARY_MAX = 200;

function cleanLines(output: string): string[] {
  return output
    .replace(ANSI, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

function cap(text: string): string {
  return text.length <= SUMMARY_MAX ? text : `${text.slice(0, SUMMARY_MAX - 1)}\u2026`;
}

/**
 * One line describing how a headless run ended, enough to fix an error without
 * reopening the session. Terminal control sequences are stripped so the text is
 * safe to render in a card.
 */
export function summariseOutput(
  output: string,
  exitCode: number | null,
): string {
  const lines = cleanLines(output);
  if (exitCode === 0) {
    return cap(lines[lines.length - 1] ?? "Completed with no output.");
  }
  const failure = lines.find((line) => /error|failed|not found|denied/i.test(line));
  const detail = failure ?? lines[lines.length - 1] ?? "no output";
  const code = exitCode === null ? "terminated" : `exit ${exitCode}`;
  return cap(`${code}: ${detail}`);
}

/** Command that reopens a finished run for review in a fresh terminal. */
export function recoverCommandLine(
  run: { cwd: string; sessionId: string },
  flavor: ShellFlavor,
): string {
  const quote = flavor === "windows" ? quoteWindows : quotePosix;
  const chain = flavor === "windows" ? ";" : " &&";
  return `cd ${quote(run.cwd)}${chain} pi --session ${quote(run.sessionId)}`;
}
