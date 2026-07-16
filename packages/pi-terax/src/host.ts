export type HostEnv = Record<string, string | undefined>;

export type TeraxHost = {
  /** The Pi session runs inside a Terax-spawned terminal (authoritative env). */
  inTerax: boolean;
  /** TERAX_FORCE=1 opt-in to operate against a reachable Terax from any shell. */
  forced: boolean;
  /** Whether the Pi-Terax control tools should be exposed. */
  available: boolean;
  termProgram?: string;
  termProgramVersion?: string;
};

// Terax injects TERAX_TERMINAL=1 and TERM_PROGRAM=Terax into every PTY it
// spawns (src-tauri/.../pty/shell_init.rs). A Pi process started in any other
// terminal never sees TERAX_TERMINAL, so this is a reliable host signal.
export function detectTeraxHost(env: HostEnv): TeraxHost {
  const termProgram = env.TERM_PROGRAM;
  const inTerax = env.TERAX_TERMINAL === "1" || termProgram === "Terax";
  const forced = env.TERAX_FORCE === "1";
  return {
    inTerax,
    forced,
    available: inTerax || forced,
    termProgram: termProgram || undefined,
    termProgramVersion: env.TERM_PROGRAM_VERSION || undefined,
  };
}

export type EnablePlatform = "darwin" | "win32" | "linux" | string;

export type EnableInstructions = {
  reason: string;
  steps: string[];
  command: string;
};

export function teraxEnableInstructions(
  platform: EnablePlatform,
): EnableInstructions {
  const launch =
    platform === "darwin"
      ? "open -a Terax"
      : platform === "win32"
        ? "start \"\" Terax"
        : "terax";
  return {
    reason:
      "Pi-Terax control tools are hidden because this session is not running inside a Terax terminal.",
    steps: [
      "Open the Terax app (install it from the Terax releases if needed).",
      "Open a terminal tab inside Terax.",
      "Start Pi from that Terax terminal so it inherits TERAX_TERMINAL=1.",
    ],
    command: launch,
  };
}
