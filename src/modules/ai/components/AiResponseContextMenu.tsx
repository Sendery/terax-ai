import { IS_MAC } from "@/lib/platform";
import type { SelectionActions } from "@/modules/ai/components/SelectionActionItems";
import type { ReadAloudOptions } from "@/modules/reader/components/ReadMenuItems";
import { isSecondaryClick } from "@/modules/terminal/lib/pointer";
import { TerminalContextMenu } from "@/modules/terminal/TerminalContextMenu";
import { createContext, type ReactNode, useRef, useState } from "react";
import { toast } from "sonner";
import { openStored, playReader, setReaderVoice, toggleReader } from "@/modules/reader/lib/player";
import { useReaderStore } from "@/modules/reader/store/readerStore";
import { AudioWave01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

export type AiResponseActions = {
  selectionActions: SelectionActions;
  onReadAloud: (text: string, options: ReadAloudOptions) => void;
  onStopReading: () => void;
};

export const AiResponseActionsContext = createContext<AiResponseActions | null>(null);

function selectionInside(response: HTMLElement): string | null {
  const selection = response.ownerDocument.getSelection();
  if (!selection || selection.isCollapsed ||
    !response.contains(selection.anchorNode) || !response.contains(selection.focusNode)) return null;
  return selection.toString();
}

export function AiResponseContextMenu({ actions, onPaste, text, streaming, children }: {
  actions: AiResponseActions;
  onPaste: () => Promise<void>;
  text: string;
  streaming: boolean;
  children: ReactNode;
}) {
  const beforeClick = useRef<string | null>(null);
  const captured = useRef<string | null>(null);
  const [docId, setDocId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const startingRef = useRef(false);
  const phase = useReaderStore((state) =>
    docId && state.playback.docId === docId ? state.playback.phase : "idle");
  const error = useReaderStore((state) =>
    docId && state.playback.docId === docId ? state.playback.error : null);
  const playing = phase === "playing" || phase === "gap" || phase === "loading";

  async function readHere(source: string, voiceId?: string) {
    if (!source.trim() || startingRef.current) return;
    startingRef.current = true;
    setStarting(true);
    try {
      const entry = await openStored({ text: source });
      setDocId(entry.id);
      if (voiceId) {
        await setReaderVoice(entry.id, voiceId);
        await playReader(entry.id);
      } else {
        await toggleReader(entry.id);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not read the response aloud.");
    } finally {
      startingRef.current = false;
      setStarting(false);
    }
  }

  return (
    <TerminalContextMenu {...actions} readSelection={() => captured.current}
      onPaste={() => void onPaste()}
      onReadAloud={(selection, options) => {
        if (options.here) void readHere(selection, options.voiceId);
        else actions.onReadAloud(selection, options);
      }}>
      <div className="flex flex-col gap-3"
        onMouseDownCapture={(event) => {
          beforeClick.current = isSecondaryClick(event, IS_MAC)
            ? selectionInside(event.currentTarget)
            : null;
        }}
        onContextMenuCapture={(event) => {
          captured.current = beforeClick.current ?? selectionInside(event.currentTarget);
          beforeClick.current = null;
        }}>
        {children}
        {!streaming && text ? (
          <button type="button" disabled={starting && !playing}
            onClick={() => {
              if (docId && (playing || phase === "paused")) {
                void toggleReader(docId).catch((error: unknown) => toast.error(String(error)));
              } else {
                void readHere(text);
              }
            }}
            className="flex w-fit items-center gap-1.5 rounded px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground">
            <HugeiconsIcon icon={AudioWave01Icon} size={13} />
            {playing ? "Pause reading" : phase === "paused" ? "Resume reading" : "Read here"}
          </button>
        ) : null}
        {error ? <p role="status" className="text-[11px] text-destructive">{error}</p> : null}
      </div>
    </TerminalContextMenu>
  );
}
