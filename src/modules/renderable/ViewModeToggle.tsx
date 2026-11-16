import { cn } from "@/lib/utils";
import { VIEW_MODES, type ViewMode } from "@/modules/renderable/viewMode";
const labels = {
  raw: "Raw",
  rendered: "Rendered",
  "side-by-side": "Side by side",
};
export function ViewModeToggle({
  mode,
  onChange,
}: {
  mode: ViewMode;
  onChange: (mode: ViewMode) => void;
}) {
  return (
    <fieldset
      aria-label="Document view"
      className="m-0 flex shrink-0 flex-wrap gap-0.5 rounded-md border border-border/60 bg-muted/40 p-0.5 text-[11px]"
    >
      {VIEW_MODES.map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={value === mode}
          onClick={() => onChange(value)}
          className={cn(
            "rounded px-2 py-1 focus-visible:outline-2 focus-visible:outline-ring",
            value === mode
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {labels[value]}
        </button>
      ))}
    </fieldset>
  );
}
