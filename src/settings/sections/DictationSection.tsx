import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTtsRuntime } from "@/modules/tts";
import { useState } from "react";
import { SectionHeader } from "../components/SectionHeader";
import { AdvancedTab } from "./dictation/AdvancedTab";
import { DictionaryTab } from "./dictation/DictionaryTab";
import { ModelsTab } from "./dictation/ModelsTab";
import { StyleTab } from "./dictation/StyleTab";
import { ErrorLine } from "./voice/ui";

type DictationTab = "models" | "style" | "dictionary" | "advanced";

/** Speech to text, laid out like Settings, Voice. */
export function DictationSection() {
  const runtime = useTtsRuntime();
  const [tab, setTab] = useState<DictationTab>("models");

  return (
    <div className="flex flex-col gap-5">
      <SectionHeader
        title="Dictation"
        description="Speak instead of typing in the AI chat. Transcribe on this machine with a model sized for its memory, or with a cloud provider."
      />

      {runtime.error ? (
        <ErrorLine message={`Could not read the engine status: ${runtime.error}`} />
      ) : null}

      <Tabs value={tab} onValueChange={(value) => setTab(value as DictationTab)}>
        <TabsList>
          <TabsTrigger value="models">Models</TabsTrigger>
          <TabsTrigger value="style">Language and style</TabsTrigger>
          <TabsTrigger value="dictionary">Dictionary</TabsTrigger>
          <TabsTrigger value="advanced">Advanced</TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === "models" ? <ModelsTab runtime={runtime} /> : null}
      {tab === "style" ? <StyleTab /> : null}
      {tab === "dictionary" ? <DictionaryTab /> : null}
      {tab === "advanced" ? <AdvancedTab runtime={runtime} /> : null}
    </div>
  );
}
