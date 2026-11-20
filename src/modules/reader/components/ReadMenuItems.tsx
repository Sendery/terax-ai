import {
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import { IS_MAC } from "@/lib/platform";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  LANGUAGE_LABELS,
  type TtsLanguage,
  useTtsStore,
  useVoiceOptions,
  type VoiceOption,
} from "@/modules/tts";
import {
  AudioWave01Icon,
  BookOpen01Icon,
  LayoutBottomIcon,
  StopIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Fragment, useEffect, useMemo } from "react";

export type ReadAloudOptions = {
  voiceId?: string;
  language?: TtsLanguage;
  /** Open the text in a Reader tab instead of speaking it in the background. */
  reader?: boolean;
  /** Read it along in the Reader panel under this tab, without leaving it. */
  here?: boolean;
};

/** The one label each reading action carries everywhere it is offered. */
export const READ_LABELS = {
  speak: "Speak",
  readHere: "Read here",
  readHereWith: "Read here with",
  readInNewTab: "Read in new tab",
  moveToTab: "Move to a tab",
  dockHere: "Dock here",
  stop: "Stop",
  resume: "Resume",
} as const;

const STOP_CHORD = IS_MAC ? "⇧⌘." : "Ctrl+Shift+.";
const READ_HERE_CHORD = IS_MAC ? "⌥⌘R" : "Ctrl+Alt+R";

type Props = {
  /** Text selected when the menu opened; empty when there is none. */
  selection: string;
  /**
   * The view can read its whole document when nothing is selected (an editor
   * or a Markdown view). Then Read here and Read in new tab stay available
   * and the empty text means "the document".
   */
  documentFallback?: boolean;
  onRead: (text: string, options: ReadAloudOptions) => void;
  onStop?: () => void;
  /** Something is sounding: one-shot speech or the Reader. */
  canStop: boolean;
};

/**
 * The voices ready to speak in the enabled languages, from the same list the
 * status bar, the Reader and Settings use: stored profiles and the providers'
 * own voices alike.
 */
function useSpeakableVoices(): {
  grouped: [TtsLanguage, VoiceOption[]][];
  any: boolean;
} {
  const hydrate = useTtsStore((s) => s.hydrate);
  useEffect(() => {
    void hydrate();
  }, [hydrate]);
  const options = useVoiceOptions();
  return useMemo(() => {
    const byLanguage = new Map<TtsLanguage, VoiceOption[]>();
    for (const option of options) {
      if (!option.ready) continue;
      const list = byLanguage.get(option.language) ?? [];
      list.push(option);
      byLanguage.set(option.language, list);
    }
    const grouped = [...byLanguage.entries()].map(
      ([language, list]): [TtsLanguage, VoiceOption[]] => [
        language,
        [...list].sort((a, b) => Number(b.isDefault) - Number(a.isDefault)),
      ],
    );
    return { grouped, any: grouped.length > 0 };
  }, [options]);
}

function VoiceItems({
  onPick,
  grouped,
}: {
  onPick: (voiceId: string) => void;
  grouped: [TtsLanguage, VoiceOption[]][];
}) {
  return (
    <>
      {grouped.map(([language, list]) => (
        <Fragment key={language}>
          <ContextMenuLabel className="text-muted-foreground">
            {LANGUAGE_LABELS[language]}
          </ContextMenuLabel>
          {list.map((voice) => (
            <ContextMenuItem key={voice.id} onSelect={() => onPick(voice.id)}>
              <span className="flex-1 truncate">{voice.name}</span>
              <span className="text-[10px] text-muted-foreground">
                {voice.isDefault ? "Default" : voice.provider}
              </span>
            </ContextMenuItem>
          ))}
        </Fragment>
      ))}
    </>
  );
}

/**
 * The reading actions every text view offers on right-click: the terminal,
 * the editor and both Markdown views. Speak says the selection without
 * showing it; Read here and Read in new tab open it in the Reader; Stop
 * silences whatever is sounding.
 */
export function ReadMenuItems({
  selection,
  documentFallback = false,
  onRead,
  onStop,
  canStop,
}: Props) {
  const { grouped, any } = useSpeakableVoices();
  // Only the languages enabled in Settings, Voice, Languages.
  const languages = usePreferencesStore((s) => s.ttsLanguages);
  const hasSelection = selection.length > 0;
  const canRead = hasSelection || documentFallback;

  return (
    <>
      <ContextMenuSub>
        <ContextMenuSubTrigger disabled={!hasSelection}>
          <HugeiconsIcon icon={AudioWave01Icon} size={14} strokeWidth={1.75} />
          <span className="flex-1">{READ_LABELS.speak}</span>
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className="min-w-48">
          <ContextMenuItem onSelect={() => onRead(selection, {})}>
            Default voice
          </ContextMenuItem>
          {languages.map((language) => (
            <ContextMenuItem
              key={language}
              onSelect={() => onRead(selection, { language })}
            >
              {LANGUAGE_LABELS[language]}
            </ContextMenuItem>
          ))}
          {any ? <ContextMenuSeparator /> : null}
          <VoiceItems
            grouped={grouped}
            onPick={(voiceId) => onRead(selection, { voiceId })}
          />
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuItem
        disabled={!canRead}
        onSelect={() => onRead(selection, { here: true })}
      >
        <HugeiconsIcon icon={LayoutBottomIcon} size={14} strokeWidth={1.75} />
        <span className="flex-1">{READ_LABELS.readHere}</span>
        <ContextMenuShortcut>{READ_HERE_CHORD}</ContextMenuShortcut>
      </ContextMenuItem>
      {any ? (
        <ContextMenuSub>
          <ContextMenuSubTrigger disabled={!canRead}>
            <HugeiconsIcon
              icon={LayoutBottomIcon}
              size={14}
              strokeWidth={1.75}
            />
            <span className="flex-1">{READ_LABELS.readHereWith}</span>
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="min-w-48">
            <VoiceItems
              grouped={grouped}
              onPick={(voiceId) => onRead(selection, { here: true, voiceId })}
            />
          </ContextMenuSubContent>
        </ContextMenuSub>
      ) : null}
      <ContextMenuItem
        disabled={!canRead}
        onSelect={() => onRead(selection, { reader: true })}
      >
        <HugeiconsIcon icon={BookOpen01Icon} size={14} strokeWidth={1.75} />
        <span className="flex-1">{READ_LABELS.readInNewTab}</span>
      </ContextMenuItem>
      <ContextMenuItem disabled={!canStop} onSelect={() => onStop?.()}>
        <HugeiconsIcon icon={StopIcon} size={14} strokeWidth={1.75} />
        <span className="flex-1">{READ_LABELS.stop}</span>
        <ContextMenuShortcut>{STOP_CHORD}</ContextMenuShortcut>
      </ContextMenuItem>
    </>
  );
}
