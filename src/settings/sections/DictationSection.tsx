import { SectionHeader } from "../components/SectionHeader";
import { VoiceBlock } from "./VoiceBlock";

/** Speech to text, kept apart from the voices Terax reads with. */
export function DictationSection() {
  return (
    <div className="flex flex-col gap-5">
      <SectionHeader
        title="Dictation"
        description="Speak instead of typing in the AI chat. Choose who transcribes your voice."
      />
      <VoiceBlock />
    </div>
  );
}
