import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { fmtShortcut, MOD_KEY } from "@/lib/platform";
import {
  LANGUAGE_LABELS,
  profilesByLanguage,
  TTS_LANGUAGES,
  useTtsStore,
  type TtsLanguage,
} from "@/modules/tts";
import {
  AudioWave01Icon,
  ClipboardPasteIcon,
  Copy01Icon,
  Flowchart01Icon,
  Note01Icon,
  Refresh01Icon,
  SparklesIcon,
  StopIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Fragment, type ReactNode, useEffect, useMemo, useState } from "react";
import { pasteIntoLeaf, repaintLeaf } from "./lib/rendererPool";
import {
  readTerminalClipboard,
  writeTerminalClipboard,
} from "./lib/terminalClipboard";

export type ReadAloudOptions = { voiceId?: string; language?: TtsLanguage };

/**
 * Selection actions shared with the floating popup that a primary-button
 * selection raises. Each receives the selection captured when the menu opened,
 * rather than re-reading it: on macOS xterm's `rightClickSelectsWord` can
 * replace the selection under the pointer before the menu is even built.
 */
export type TerminalSelectionActions = {
  onAsk: (text: string) => void;
  onAddToNote: (text: string) => void;
  onOpenMermaid: (text: string) => void;
};

type Props = {
  children: ReactNode;
  leafId: number;
  /** Selection captured before the menu opened, since a right-click can move
   *  the xterm selection on its own. */
  readSelection: () => string | null;
  onReadAloud?: (text: string, options: ReadAloudOptions) => void;
  onStopReading?: () => void;
  onRestoreFocus?: () => void;
  selectionActions?: TerminalSelectionActions;
  /** Private terminals are hidden from the AI and from snapshots; reading them
   *  aloud keeps the same signal and is not offered. */
  privateTerminal?: boolean;
};

/**
 * Terminal pane context menu. The body is a child component so its store
 * subscriptions exist only while the menu is open.
 */
export function TerminalContextMenu({
  children,
  leafId,
  readSelection,
  onReadAloud,
  onStopReading,
  onRestoreFocus,
  selectionActions,
  privateTerminal = false,
}: Props) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent
        className="min-w-44"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onRestoreFocus?.();
        }}
      >
        <MenuBody
          leafId={leafId}
          readSelection={readSelection}
          onReadAloud={onReadAloud}
          onStopReading={onStopReading}
          selectionActions={selectionActions}
          privateTerminal={privateTerminal}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
}

function MenuBody({
  leafId,
  readSelection,
  onReadAloud,
  onStopReading,
  selectionActions,
  privateTerminal,
}: Omit<Props, "children" | "onRestoreFocus">) {
  // Read once at mount: the menu only mounts on open, and the selection must
  // not change under the open menu.
  const [selection] = useState(() => readSelection()?.trim() ?? "");
  const profiles = useTtsStore((s) => s.profiles);
  const defaults = useTtsStore((s) => s.defaults);
  const speaking = useTtsStore((s) => s.speaking);
  const hydrate = useTtsStore((s) => s.hydrate);

  const offersSpeech = Boolean(onReadAloud) && !privateTerminal;

  useEffect(() => {
    if (!offersSpeech) return;
    void hydrate();
  }, [offersSpeech, hydrate]);

  const grouped = useMemo(() => profilesByLanguage(profiles), [profiles]);

  return (
    <>
      <ContextMenuItem
        disabled={selection.length === 0}
        onSelect={() => void writeTerminalClipboard(selection)}
      >
        <HugeiconsIcon icon={Copy01Icon} size={14} strokeWidth={1.75} />
        <span className="flex-1">Copy</span>
      </ContextMenuItem>
      <ContextMenuItem
        onSelect={() => {
          void readTerminalClipboard().then((text) => {
            if (text) pasteIntoLeaf(leafId, text);
          });
        }}
      >
        <HugeiconsIcon icon={ClipboardPasteIcon} size={14} strokeWidth={1.75} />
        <span className="flex-1">Paste</span>
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={() => repaintLeaf(leafId)}>
        <HugeiconsIcon icon={Refresh01Icon} size={14} strokeWidth={1.75} />
        <span className="flex-1">Redraw</span>
      </ContextMenuItem>
      {selectionActions ? (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem
            disabled={selection.length === 0}
            onSelect={() => selectionActions.onAsk(selection)}
          >
            <HugeiconsIcon icon={SparklesIcon} size={14} strokeWidth={1.75} />
            <span className="flex-1">Ask Terax</span>
            <ContextMenuShortcut>
              {fmtShortcut(MOD_KEY, "J")}
            </ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem
            disabled={selection.length === 0}
            onSelect={() => selectionActions.onAddToNote(selection)}
          >
            <HugeiconsIcon icon={Note01Icon} size={14} strokeWidth={1.75} />
            <span className="flex-1">Add to Note</span>
            <ContextMenuShortcut>
              {fmtShortcut(MOD_KEY, "L")}
            </ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem
            disabled={selection.length === 0}
            onSelect={() => selectionActions.onOpenMermaid(selection)}
          >
            <HugeiconsIcon
              icon={Flowchart01Icon}
              size={14}
              strokeWidth={1.75}
            />
            <span className="flex-1">Open Mermaid</span>
          </ContextMenuItem>
        </>
      ) : null}
      {offersSpeech && onReadAloud ? (
        <>
          <ContextMenuSeparator />
          <ContextMenuSub>
            <ContextMenuSubTrigger disabled={selection.length === 0}>
              <HugeiconsIcon
                icon={AudioWave01Icon}
                size={14}
                strokeWidth={1.75}
              />
              <span className="flex-1">Read aloud</span>
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="min-w-48">
              <ContextMenuItem onSelect={() => onReadAloud(selection, {})}>
                Default voice
              </ContextMenuItem>
              {TTS_LANGUAGES.map((language) => (
                <ContextMenuItem
                  key={language}
                  onSelect={() => onReadAloud(selection, { language })}
                >
                  {LANGUAGE_LABELS[language]}
                </ContextMenuItem>
              ))}
              {profiles.length > 0 ? <ContextMenuSeparator /> : null}
              {TTS_LANGUAGES.filter(
                (language) => grouped[language].length > 0,
              ).map((language) => (
                <Fragment key={language}>
                  <ContextMenuLabel className="text-muted-foreground">
                    {LANGUAGE_LABELS[language]}
                  </ContextMenuLabel>
                  {grouped[language].map((profile) => (
                    <ContextMenuItem
                      key={profile.id}
                      onSelect={() =>
                        onReadAloud(selection, { voiceId: profile.id })
                      }
                    >
                      <span className="flex-1 truncate">{profile.name}</span>
                      {defaults[language] === profile.id ? (
                        <span className="text-[10px] text-muted-foreground">
                          Default
                        </span>
                      ) : null}
                    </ContextMenuItem>
                  ))}
                </Fragment>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuItem
            disabled={!speaking}
            onSelect={() => onStopReading?.()}
          >
            <HugeiconsIcon icon={StopIcon} size={14} strokeWidth={1.75} />
            <span className="flex-1">Stop reading</span>
          </ContextMenuItem>
        </>
      ) : null}
    </>
  );
}
