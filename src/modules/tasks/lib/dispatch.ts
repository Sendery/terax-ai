import { agentCapabilities, DEFAULT_TASK_AGENT, type TaskAgent } from "./agents";
import type { ScheduledTask } from "./task";

export type ShellFlavor = "posix" | "windows";

const SAFE_ARG = /^[A-Za-z0-9_@%+=:,./-]+$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Whether a session id can be handed to a CLI that only accepts UUIDs. */
export function isUuidSessionId(value: string): boolean {
  return UUID_RE.test(value);
}

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
  // The seed names the session, so asking for a new seed is what starts a new
  // conversation. Tasks stored before seeds existed keep their derived id.
  return task.sessions[0]?.id ?? task.seed ?? `terax-${task.id}`;
}

export type ArgvOptions = {
  headless: boolean;
  /** True when a previous run already created this session. */
  resume?: boolean;
};

/**
 * argv for one run of one agent CLI. An interactive launch deliberately omits
 * the prompt: it is typed into the session afterwards so multiline prompts
 * survive.
 *
 * The three CLIs disagree about sessions, and the disagreement is load bearing:
 * pi creates a session id if it is missing, claude refuses a `--session-id` it
 * has already seen and needs `--resume` instead, and codex mints its own ids so
 * the only continuation it offers is its most recent session in the directory.
 */
export function buildAgentArgv(
  task: ScheduledTask,
  sessionId: string,
  options: ArgvOptions,
): string[] {
  switch (task.agent) {
    case "claude":
      return claudeArgv(task, sessionId, options);
    case "codex":
      return codexArgv(task, options);
    default:
      return piArgv(task, sessionId, options);
  }
}

function piArgv(
  task: ScheduledTask,
  sessionId: string,
  options: ArgvOptions,
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

function claudeArgv(
  task: ScheduledTask,
  sessionId: string,
  options: ArgvOptions,
): string[] {
  const argv = ["claude"];
  if (options.headless) argv.push("--print");
  if (task.model) argv.push("--model", task.model);
  // A routine must not inherit context, and claude starts fresh by default.
  if (task.mode === "task" && isUuidSessionId(sessionId)) {
    argv.push(options.resume ? "--resume" : "--session-id", sessionId);
  }
  if (options.headless) argv.push(task.prompt);
  return argv;
}

function codexArgv(task: ScheduledTask, options: ArgvOptions): string[] {
  const argv = ["codex"];
  if (options.headless) argv.push("exec");
  if (task.mode === "task" && options.resume) argv.push("resume", "--last");
  if (task.model) argv.push("-m", task.model);
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
  run: { cwd: string; sessionId: string; agent?: TaskAgent },
  flavor: ShellFlavor,
): string {
  const quote = flavor === "windows" ? quoteWindows : quotePosix;
  const chain = flavor === "windows" ? ";" : " &&";
  const agent = run.agent ?? DEFAULT_TASK_AGENT;
  const binary = agentCapabilities(agent).binary;
  const resume = (): string => {
    switch (agent) {
      case "claude":
        return isUuidSessionId(run.sessionId)
          ? `--resume ${quote(run.sessionId)}`
          : "--continue";
      case "codex":
        // Codex ids are minted by codex; the newest session in this directory
        // is the closest thing to the run we are reopening.
        return "resume --last";
      default:
        return `--session ${quote(run.sessionId)}`;
    }
  };
  return `cd ${quote(run.cwd)}${chain} ${binary} ${resume()}`;
}
