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
import {
  isProfileSpeakable,
  LANGUAGE_LABELS,
  profilesByLanguage,
  TTS_LANGUAGES,
  type TtsLanguage,
  useTtsStore,
  type VoiceProfile,
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

function useSpeakableVoices(): {
  grouped: Record<TtsLanguage, VoiceProfile[]>;
  defaults: Record<TtsLanguage, string | null>;
  any: boolean;
} {
  const profiles = useTtsStore((s) => s.profiles);
  const defaults = useTtsStore((s) => s.defaults);
  const hydrate = useTtsStore((s) => s.hydrate);
  useEffect(() => {
    void hydrate();
  }, [hydrate]);
  return useMemo(() => {
    const speakable = profiles.filter(isProfileSpeakable);
    return {
      grouped: profilesByLanguage(speakable),
      defaults,
      any: speakable.length > 0,
    };
  }, [profiles, defaults]);
}

function VoiceItems({
  onPick,
  grouped,
  defaults,
}: {
  onPick: (voiceId: string) => void;
  grouped: Record<TtsLanguage, VoiceProfile[]>;
  defaults: Record<TtsLanguage, string | null>;
}) {
  return (
    <>
      {TTS_LANGUAGES.filter((language) => grouped[language].length > 0).map(
        (language) => (
          <Fragment key={language}>
            <ContextMenuLabel className="text-muted-foreground">
              {LANGUAGE_LABELS[language]}
            </ContextMenuLabel>
            {grouped[language].map((profile) => (
              <ContextMenuItem
                key={profile.id}
                onSelect={() => onPick(profile.id)}
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
        ),
      )}
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
  const { grouped, defaults, any } = useSpeakableVoices();
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
          {TTS_LANGUAGES.map((language) => (
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
            defaults={defaults}
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
              defaults={defaults}
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
