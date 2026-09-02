import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { agentLabel } from "@/modules/tasks/lib/agents";
import { AgentIcon } from "../lib/agentIcon";
import { describeSavedSession, type SavedAgentSession } from "../lib/restore";

type Props = {
  sessions: SavedAgentSession[];
  onRestore: (sessions: SavedAgentSession[]) => void;
  onDismiss: () => void;
};

/**
 * Asks whether to reopen the agent sessions that were live when Terax last
 * closed. Every session is listed with the directory it ran in, because
 * resuming one starts a real agent process and the user is the only one who
 * knows which conversations are still wanted.
 */
export function AgentRestoreDialog({ sessions, onRestore, onDismiss }: Props) {
  const [selected, setSelected] = useState<Set<number>>(new Set());

  useEffect(() => {
    setSelected(new Set(sessions.map((_, index) => index)));
  }, [sessions]);

  const open = sessions.length > 0;
  const chosen = sessions.filter((_, index) => selected.has(index));

  const toggle = (index: number) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onDismiss()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Reopen agent sessions?</DialogTitle>
          <DialogDescription>
            {sessions.length === 1
              ? "One agent session was running when Terax last closed."
              : `${sessions.length} agent sessions were running when Terax last closed.`}{" "}
            Reopening resumes the conversation in its terminal.
          </DialogDescription>
        </DialogHeader>

        <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto">
          {sessions.map((session, index) => {
            const id = `restore-${session.agent}-${session.tabIndex}-${index}`;
            return (
              <li key={id}>
                <label
                  htmlFor={id}
                  className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-accent/50"
                >
                  <Checkbox
                    id={id}
                    checked={selected.has(index)}
                    onCheckedChange={() => toggle(index)}
                  />
                  <AgentIcon
                    agent={session.agent}
                    harness={session.agent}
                    size={16}
                    className="shrink-0 text-muted-foreground"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">
                      {agentLabel(session.agent)}
                      {session.tabTitle ? ` · ${session.tabTitle}` : ""}
                    </span>
                    <span className="block truncate text-muted-foreground text-xs">
                      {describeSavedSession(session)}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>

        <DialogFooter>
          <Button variant="ghost" onClick={onDismiss}>
            Not now
          </Button>
          <Button
            disabled={chosen.length === 0}
            onClick={() => onRestore(chosen)}
          >
            {chosen.length === sessions.length
              ? "Reopen all"
              : `Reopen ${chosen.length}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
