import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { setSttDictionary } from "@/modules/settings/store";
import { dictionaryContext, STT_CONTEXT_MAX_CHARS } from "@/modules/stt/lib/postprocess";
import {
  coerceSttDictionary,
  parseSttDictionaryImport,
  serializeSttDictionary,
  STT_DICTIONARY_MAX_ENTRIES,
  type SttDictionaryEntry,
} from "@/modules/stt/lib/settings";
import {
  Add01Icon,
  Book02Icon,
  Copy01Icon,
  Delete02Icon,
  Upload04Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Card, ErrorLine, FieldLabel } from "../voice/ui";

export function DictionaryTab() {
  const dictionary = usePreferencesStore((s) => s.sttDictionary);
  const [written, setWritten] = useState("");
  const [spoken, setSpoken] = useState("");
  const [paste, setPaste] = useState("");
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const save = (next: SttDictionaryEntry[]) => void setSttDictionary(next);

  const add = () => {
    const entry: SttDictionaryEntry = spoken.trim()
      ? { written, spoken }
      : { written };
    const next = coerceSttDictionary([...dictionary, entry]);
    if (next.length === dictionary.length) {
      setError(
        dictionary.length >= STT_DICTIONARY_MAX_ENTRIES
          ? `The dictionary holds up to ${STT_DICTIONARY_MAX_ENTRIES} terms.`
          : "That term is empty, too long or already in the list.",
      );
      return;
    }
    setError(null);
    save(next);
    setWritten("");
    setSpoken("");
  };

  const merge = (text: string, source: string) => {
    const imported = parseSttDictionaryImport(text);
    if (imported.length === 0) {
      setError(`No terms found in ${source}.`);
      return;
    }
    const next = coerceSttDictionary([...dictionary, ...imported]);
    setError(null);
    save(next);
    toast.success(`${next.length - dictionary.length} terms added from ${source}.`);
  };

  const copyExport = async () => {
    try {
      await navigator.clipboard.writeText(serializeSttDictionary(dictionary));
      toast.success("Dictionary copied as JSON.");
    } catch {
      setError("The clipboard is not available here.");
    }
  };

  const context = dictionaryContext(dictionary);
  const contextFull = context.length > STT_CONTEXT_MAX_CHARS - 40;

  return (
    <section className="flex flex-col gap-3">
      <Card
        title="Dictionary"
        icon={Book02Icon}
        subtitle="Names, products and jargon. The local engine is told to expect them, and the transcript is corrected with them."
      >
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <div className="flex min-w-0 flex-col gap-1">
            <FieldLabel htmlFor="stt-term-written">Write it as</FieldLabel>
            <Input
              id="stt-term-written"
              value={written}
              onChange={(e) => setWritten(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") add();
              }}
              placeholder="Pi-Terax"
              spellCheck={false}
              className="h-8 text-[11.5px]"
            />
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <FieldLabel htmlFor="stt-term-spoken">Heard as (optional)</FieldLabel>
            <Input
              id="stt-term-spoken"
              value={spoken}
              onChange={(e) => setSpoken(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") add();
              }}
              placeholder="piterax"
              spellCheck={false}
              className="h-8 text-[11.5px]"
            />
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 px-2.5 text-[11px]"
            disabled={!written.trim()}
            onClick={add}
          >
            <HugeiconsIcon icon={Add01Icon} size={12} strokeWidth={1.75} />
            Add
          </Button>
        </div>
        <p className="text-[10.5px] text-muted-foreground">
          "Heard as" is how the transcript spells the term when it gets it wrong.
          Matching ignores case and accents and only replaces whole words.
        </p>
        {error ? <ErrorLine message={error} /> : null}
        {dictionary.length === 0 ? (
          <p className="text-[10.5px] text-muted-foreground">No terms yet.</p>
        ) : (
          <ul className="flex max-h-72 flex-col gap-1 overflow-auto">
            {dictionary.map((entry, index) => (
              <li
                key={`${entry.written}\u0000${entry.spoken ?? ""}`}
                className="flex items-center gap-2 rounded-md border border-border/50 bg-card/40 px-2.5 py-1"
              >
                <span className="min-w-0 flex-1 truncate text-[11.5px]">
                  {entry.spoken ? (
                    <>
                      <span className="text-muted-foreground">{entry.spoken}</span>
                      {" -> "}
                    </>
                  ) : null}
                  <span className="font-medium">{entry.written}</span>
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Remove ${entry.written}`}
                  className="h-6 px-1.5 text-muted-foreground hover:text-destructive"
                  onClick={() => save(dictionary.filter((_, i) => i !== index))}
                >
                  <HugeiconsIcon icon={Delete02Icon} size={12} strokeWidth={1.75} />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-[10.5px] text-muted-foreground">
          {dictionary.length} of {STT_DICTIONARY_MAX_ENTRIES} terms.
          {contextFull
            ? " The engine only receives the first terms that fit in 2000 characters; corrections still apply to all."
            : null}
        </p>
      </Card>

      <Card
        title="Import and export"
        icon={Upload04Icon}
        subtitle="A text file with one term per line, 'heard -> written' for corrections, or the JSON Terax copies."
      >
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".txt,.json,.csv,text/plain,application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              void file.text().then(
                (text) => merge(text, file.name),
                () => setError(`Could not read ${file.name}.`),
              );
            }}
          />
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 px-2 text-[11px]"
            onClick={() => fileRef.current?.click()}
          >
            <HugeiconsIcon icon={Upload04Icon} size={12} strokeWidth={1.75} />
            Import file
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 px-2 text-[11px]"
            disabled={dictionary.length === 0}
            onClick={() => void copyExport()}
          >
            <HugeiconsIcon icon={Copy01Icon} size={12} strokeWidth={1.75} />
            Copy as JSON
          </Button>
          {dictionary.length > 0 ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-[11px] text-muted-foreground hover:text-destructive"
              onClick={() => save([])}
            >
              Clear all
            </Button>
          ) : null}
        </div>
        <Textarea
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          placeholder={"Kokoro\nsenderi -> Sendery\npiterax -> Pi-Terax"}
          aria-label="Paste terms to import"
          spellCheck={false}
          className="min-h-20 font-mono text-[11px]"
        />
        <div>
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-[11px]"
            disabled={!paste.trim()}
            onClick={() => {
              merge(paste, "the pasted list");
              setPaste("");
            }}
          >
            Add pasted terms
          </Button>
        </div>
        <p className="text-[10.5px] text-muted-foreground">
          The dictionary lives in the Terax settings file. Copy it somewhere safe
          before reinstalling.
        </p>
      </Card>
    </section>
  );
}
