import { Button } from "@/components/ui/button";
import { native } from "@/modules/ai/lib/native";
import {
  fullDiskAccessCopy,
  openFullDiskAccessSettings,
  useFullDiskAccess,
} from "@/modules/privacy";
import { useEffect, useState } from "react";
import { SettingRow } from "./SettingRow";

/**
 * macOS only. `missing` renders the call to action while the grant is absent,
 * `granted` a quiet row once it is there, so each can sit where it belongs:
 * the first at the top of the section, the second among the other rows.
 */
export function FullDiskAccessCard({ show }: { show: "missing" | "granted" }) {
  const { status, refresh } = useFullDiskAccess();
  const [sandbox, setSandbox] = useState(false);
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

  if (status === null || status === "not-applicable") return null;

  if ((status === "granted") !== (show === "granted")) return null;

  if (status === "granted") {
    return (
      <SettingRow
        title="Full Disk Access"
        description="Granted. Shells and agents inside Terax reach protected folders without macOS asking for each one."
      >
        <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10.5px] font-medium text-emerald-700 dark:text-emerald-300">
          Granted
        </span>
      </SettingRow>
    );
  }

  const copy = fullDiskAccessCopy(sandbox);
  const open = async () => {
    setError(null);
    try {
      await openFullDiskAccessSettings();
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-amber-500/40 bg-amber-500/5 p-4">
      <div className="flex flex-col gap-1">
        <span className="text-[12.5px] font-medium">{copy.title}</span>
        <p className="text-[11.5px] leading-relaxed text-muted-foreground">
          {copy.body}
        </p>
      </div>
      <ol className="list-decimal space-y-0.5 pl-4 text-[11.5px] leading-relaxed text-muted-foreground">
        <li>Open Privacy &amp; Security, Full Disk Access.</li>
        <li>
          Turn on {sandbox ? "Pi-Terax Sandbox" : "Terax"} in the list. If it
          is not listed, add it with the + button.
        </li>
        <li>
          macOS applies the grant the next time Terax starts. Restart when
          your sessions can be closed; nothing here restarts for you.
        </li>
      </ol>
      {status === "unknown" ? (
        <p className="text-[11px] text-muted-foreground">
          Terax could not tell whether the grant is already in place on this
          Mac.
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => void open()}>
          Open Full Disk Access settings
        </Button>
        <Button size="sm" variant="outline" onClick={refresh}>
          Check again
        </Button>
        {error ? (
          <span className="text-[11px] text-destructive">{error}</span>
        ) : null}
      </div>
    </div>
  );
}
