import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  STT_PROVIDER_LABELS,
  WHISPERCPP_DEFAULT_BASE_URL,
  type SttProvider,
} from "@/modules/ai/config";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  setGroqSttModel,
  setSttProvider,
  setWhispercppBaseURL,
} from "@/modules/settings/store";
import { ArrowDown01Icon, Mic01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useState } from "react";

export function VoiceBlock() {
  const sttProvider = usePreferencesStore((s) => s.sttProvider);
  const groqSttModel = usePreferencesStore((s) => s.groqSttModel);
  const whispercppBaseURL = usePreferencesStore((s) => s.whispercppBaseURL);
  const [urlDraft, setUrlDraft] = useState(whispercppBaseURL);
  const [groqModelDraft, setGroqModelDraft] = useState(groqSttModel);

  useEffect(() => setUrlDraft(whispercppBaseURL), [whispercppBaseURL]);
  useEffect(() => setGroqModelDraft(groqSttModel), [groqSttModel]);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border/60 bg-card/60 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <HugeiconsIcon icon={Mic01Icon} size={15} strokeWidth={1.5} />
        <span className="text-[12.5px] font-medium">Voice input</span>
      </div>

      <FieldRow label="Provider">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              className="h-8 flex-1 justify-between gap-2 px-2.5 text-[11.5px]"
            >
              <span>{STT_PROVIDER_LABELS[sttProvider]}</span>
              <HugeiconsIcon
                icon={ArrowDown01Icon}
                size={11}
                strokeWidth={2}
                className="opacity-70"
              />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-44 p-1">
            {(Object.keys(STT_PROVIDER_LABELS) as SttProvider[]).map((p) => (
              <DropdownMenuItem
                key={p}
                onSelect={() => void setSttProvider(p)}
                className={cn(
                  "flex items-center gap-2 text-[12px]",
                  p === sttProvider && "bg-accent/50",
                )}
              >
                <span>{STT_PROVIDER_LABELS[p]}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </FieldRow>

      <p className="text-[10.5px] leading-relaxed text-muted-foreground">
        {sttProvider === "openai" &&
          "Uses your official OpenAI API key and the Whisper model for transcription."}
        {sttProvider === "groq" &&
          "Uses your official Groq API key and Groq's Whisper endpoint for transcription."}
        {sttProvider === "whispercpp" &&
          "Connects to a local Whisper.cpp server for fully offline transcription."}
      </p>

      {sttProvider === "groq" && (
        <div className="flex flex-col gap-2.5">
          <FieldRow label="Model">
            <Input
              value={groqModelDraft}
              onChange={(e) => setGroqModelDraft(e.target.value)}
              onBlur={() => {
                const v = groqModelDraft.trim();
                if (v !== groqSttModel) void setGroqSttModel(v);
              }}
              placeholder="whisper-large-v3-turbo"
              spellCheck={false}
              className="h-8 font-mono text-[11.5px]"
            />
          </FieldRow>
        </div>
      )}

      {sttProvider === "whispercpp" && (
        <div className="flex flex-col gap-2.5">
          <FieldRow label="Base URL">
            <Input
              value={urlDraft}
              onChange={(e) => setUrlDraft(e.target.value)}
              onBlur={() => {
                const v = urlDraft.trim();
                if (v !== whispercppBaseURL) void setWhispercppBaseURL(v);
              }}
              placeholder={WHISPERCPP_DEFAULT_BASE_URL}
              spellCheck={false}
              className="h-8 font-mono text-[11.5px]"
            />
          </FieldRow>
        </div>
      )}
    </div>
  );
}

function FieldRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-16 shrink-0 text-[11px] tracking-tight text-muted-foreground">
        {label}
      </span>
      <div className="flex flex-1 items-center">{children}</div>
    </div>
  );
}
