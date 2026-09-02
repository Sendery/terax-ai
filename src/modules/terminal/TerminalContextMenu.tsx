import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
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
  StopIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Fragment, type ReactNode, useEffect, useMemo, useState } from "react";
import { pasteIntoLeaf } from "./lib/rendererPool";
import {
  readTerminalClipboard,
  writeTerminalClipboard,
} from "./lib/terminalClipboard";

export type ReadAloudOptions = { voiceId?: string; language?: TtsLanguage };

type Props = {
  children: ReactNode;
  leafId: number;
  /** Selection captured before the menu opened, since a right-click can move
   *  the xterm selection on its own. */
  readSelection: () => string | null;
  onReadAloud?: (text: string, options: ReadAloudOptions) => void;
  onStopReading?: () => void;
  onRestoreFocus?: () => void;
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
