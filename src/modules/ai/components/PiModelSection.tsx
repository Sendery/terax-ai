import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { setPiModel } from "@/modules/settings/store";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { RefreshIcon, Tick01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect } from "react";
import { piDefaultModelLabel } from "../cli/pi";
import { loadPiModels, usePiModelsStore } from "../cli/piModels";

export const PI_MODEL_ID = "cli-pi-agent";

/** Short label for the trigger: the chosen Pi model, or Pi's own default. */
export function usePiModelLabel(): string {
  const piModel = usePreferencesStore((s) => s.piModel);
  const defaults = usePiModelsStore((s) => s.defaults);
  if (piModel) return piModel.split("/").pop() ?? piModel;
  return defaults?.defaultModel ?? "default";
}

/**
 * The models Pi itself can use, listed under the Pi provider in the model
 * picker. Picking one selects Pi as the chat model and passes the choice as
 * `--model`; "Pi default" leaves it to Pi's own settings.
 */
export function PiModelSection({
  selected,
  onPick,
}: {
  selected: boolean;
  onPick: () => void;
}) {
  const piModel = usePreferencesStore((s) => s.piModel);
  const { status, models, defaults, error } = usePiModelsStore();

  useEffect(() => {
    void loadPiModels();
  }, []);

  const pick = (value: string) => {
    void setPiModel(value);
    onPick();
  };
  const defaultLabel = piDefaultModelLabel(defaults);

  return (
    <div className="flex flex-col pb-1">
      <div className="flex items-center gap-1.5 px-3 pt-1 pb-1 text-[10.5px] text-muted-foreground">
        <span className="flex-1">
          Models with credentials in Pi. Its extensions, Pi-Terax included, come
          along.
        </span>
        <button
          type="button"
          title="Refresh Pi models"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void loadPiModels(true);
          }}
          className="shrink-0 rounded p-0.5 text-muted-foreground/70 transition-colors hover:text-foreground"
        >
          {status === "loading" ? (
            <Spinner className="size-3" />
          ) : (
            <HugeiconsIcon icon={RefreshIcon} size={12} strokeWidth={1.75} />
          )}
        </button>
      </div>

      <PiModelRow
        label="Pi default"
        detail={defaultLabel ?? "from Pi settings"}
        active={selected && piModel === ""}
        onPick={() => pick("")}
      />
      {models.map((m) => {
        const value = `${m.provider}/${m.model}`;
        return (
          <PiModelRow
            key={value}
            label={m.model}
            detail={[m.provider, m.context, m.thinking ? "thinking" : null]
              .filter(Boolean)
              .join(" · ")}
            active={selected && piModel === value}
            onPick={() => pick(value)}
          />
        );
      })}
      {status === "error" ? (
        <p className="px-3 py-1.5 text-[10.5px] text-amber-600 dark:text-amber-400">
          Could not list Pi models: {error}
        </p>
      ) : null}
      {status === "ready" && models.length === 0 ? (
        <p className="px-3 py-1.5 text-[10.5px] text-muted-foreground">
          Pi reports no model with credentials. Run <code>pi</code> and
          <code> /login</code> in a terminal.
        </p>
      ) : null}
    </div>
  );
}

function PiModelRow({
  label,
  detail,
  active,
  onPick,
}: {
  label: string;
  detail: string;
  active: boolean;
  onPick: () => void;
}) {
  return (
    <DropdownMenuItem
      onSelect={(e) => {
        e.preventDefault();
        onPick();
      }}
      className={cn(
        "mx-1 my-0.5 flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5",
        active ? "bg-accent/60 text-foreground" : "text-foreground/85",
      )}
    >
      <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
        <span className="shrink-0 font-mono text-[11.5px] leading-none">
          {label}
        </span>
        <span className="truncate text-[10.5px] leading-none text-muted-foreground">
          {detail}
        </span>
      </div>
      {active ? (
        <HugeiconsIcon
          icon={Tick01Icon}
          size={13}
          strokeWidth={2}
          className="shrink-0 text-foreground"
        />
      ) : null}
    </DropdownMenuItem>
  );
}
