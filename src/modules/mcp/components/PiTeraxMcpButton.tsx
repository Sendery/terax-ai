import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { PiIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useMemo } from "react";
import { toast } from "sonner";
import { describeMcp, type McpTone, summarizeMcp } from "../lib/summary";
import {
  configureMcpTargets,
  refreshMcpStatus,
  useMcpStore,
} from "../store/mcpStore";

const DOT: Record<McpTone | "unknown", string> = {
  configured: "bg-emerald-500",
  partial: "bg-amber-500",
  missing: "bg-rose-500",
  unavailable: "bg-muted-foreground/40",
  unknown: "bg-muted-foreground/40",
};

/**
 * Pi-Terax MCP status next to the agent picker. The dot says whether the
 * agent CLIs on this machine (Claude Code, Codex, Cursor, OpenCode) can reach
 * Terax through `terax --mcp`; clicking registers it where it is missing or
 * points at another binary.
 */
export function PiTeraxMcpButton({ compact = false }: { compact?: boolean }) {
  const status = useMcpStore((s) => s.status);
  const busy = useMcpStore((s) => s.busy);
  const error = useMcpStore((s) => s.error);
  const summary = useMemo(() => (status ? summarizeMcp(status) : null), [status]);

  useEffect(() => {
    void refreshMcpStatus();
  }, []);

  const tone = summary?.tone ?? "unknown";
  const title = error
    ? `Pi-Terax MCP: ${error}`
    : describeMcp(status, summary);

  const onClick = async () => {
    const before = summary;
    const after = await configureMcpTargets();
    if (!after) {
      const why = useMcpStore.getState().error;
      if (why) toast.error("Could not configure Pi-Terax MCP", { description: why });
      return;
    }
    const result = summarizeMcp(after);
    if (result.tone === "unavailable") {
      toast.info("No agent CLI to configure", {
        description: "Install Claude Code, Codex, Cursor Agent or OpenCode first.",
      });
    } else if (result.pending.length === 0) {
      toast.success(
        before?.tone === "configured"
          ? "Pi-Terax MCP is already configured"
          : "Pi-Terax MCP configured",
        { description: result.detected.map((t) => t.label).join(", ") },
      );
    } else {
      toast.warning("Pi-Terax MCP is not configured everywhere", {
        description: result.pending
          .map((t) => `${t.label}: ${t.detail ?? t.state}`)
          .join("\n"),
      });
    }
  };

  return (
    <Button
      type="button"
      size="xs"
      variant="outline"
      disabled={busy === "configuring"}
      onClick={() => void onClick()}
      onPointerEnter={() => void refreshMcpStatus()}
      aria-label={`Pi-Terax MCP: ${tone}. Click to configure.`}
      title={title}
      className={cn(
        "flex h-6 shrink-0 items-center gap-1 rounded-md border border-border/60 bg-card px-1.5 text-[10.5px] text-muted-foreground transition-colors hover:border-border hover:bg-accent hover:text-foreground",
        compact && "border-transparent bg-transparent",
      )}
    >
      {busy === "configuring" ? (
        <Spinner className="size-[11px]" />
      ) : (
        <HugeiconsIcon icon={PiIcon} size={11} strokeWidth={1.75} />
      )}
      {compact ? null : <span>Pi-Terax</span>}
      <span
        aria-hidden
        className={cn(
          "size-1.5 rounded-full",
          DOT[tone],
          busy === "checking" && !status && "animate-pulse",
        )}
      />
    </Button>
  );
}
