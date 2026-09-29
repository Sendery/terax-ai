import { Button } from "@/components/ui/button";
import { native } from "@/modules/ai/lib/native";
import { relaunch } from "@tauri-apps/plugin-process";
import { useEffect, useState } from "react";

type Step = "idle" | "confirm" | "working" | "error";

/**
 * Shown only in a sandbox build: says what is isolated and offers to start
 * over from the installed app's data. The installed Terax renders nothing here.
 */
export function SandboxPanel() {
  const [sandbox, setSandbox] = useState(false);
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    native
      .appProfile()
      .then((profile) => {
        if (alive) setSandbox(profile === "sandbox");
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  if (!sandbox) return null;

  const reset = async () => {
    setStep("working");
    setError(null);
    try {
      await native.sandboxResetFromInstalled();
      await relaunch();
    } catch (e) {
      setError(String(e));
      setStep("error");
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-sky-500/30 bg-sky-500/5 p-4">
      <div className="flex items-center gap-2">
        <span className="rounded-full border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wide text-sky-700 dark:text-sky-300">
          Sandbox
        </span>
        <span className="text-[12px] font-medium">
          Running on a copy of the installed Terax
        </span>
      </div>
      <p className="text-[11.5px] leading-relaxed text-muted-foreground">
        Nothing changed here reaches the installed app. Settings, spaces,
        sessions and every other store, the window layout, notifications, macOS
        permissions, the scheduled-task waker and the Pi bridge are this
        sandbox's own. Scheduled tasks arrive paused and live agent sessions are
        not offered for resume, so nothing here acts outside Terax on its own.
        Saved keys are read from the installed app until you change or remove
        them here.
      </p>
      {step === "confirm" ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11.5px]">
            Replace this sandbox's data with a fresh copy and restart?
          </span>
          <Button size="sm" variant="outline" onClick={() => setStep("idle")}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => void reset()}>
            Reset and restart
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={step === "working"}
            onClick={() => setStep("confirm")}
          >
            {step === "working" ? "Restarting…" : "Reset from installed Terax"}
          </Button>
          {error ? (
            <span className="text-[11px] text-destructive">{error}</span>
          ) : null}
        </div>
      )}
    </div>
  );
}
