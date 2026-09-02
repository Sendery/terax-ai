import { Button } from "@/components/ui/button";
import { Cancel01Icon, Key01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

/**
 * What the AI input bar shows when no provider is configured. It is a surface
 * the user opened, so it owns a way to close itself: without one the only exit
 * would be adding a key, which is exactly the decision being offered.
 */
export function AiInputBarConnect({
  onAdd,
  onDismiss,
}: {
  onAdd: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="shrink-0 border-t border-border/60 bg-card/40 px-3 py-2">
      <div className="flex h-10 items-center justify-between gap-3 rounded-lg px-3 text-xs">
        <span className="text-muted-foreground">
          Connect any AI provider (or use local models) - your key stays in your
          OS keychain.
        </span>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button size="xs" onClick={onAdd}>
            <HugeiconsIcon icon={Key01Icon} />
            Connect provider
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-6 text-muted-foreground"
            onClick={onDismiss}
            title="Close"
            aria-label="Close AI panel"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={13} strokeWidth={1.75} />
          </Button>
        </div>
      </div>
    </div>
  );
}
