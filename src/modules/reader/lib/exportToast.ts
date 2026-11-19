import { toast } from "sonner";
import type { ExportSplit } from "./flow";
import { exportReader } from "./player";

const SPLIT_LABEL: Record<ExportSplit, string> = {
  none: "the reading as one audio file",
  heading: "one audio file per section",
  paragraph: "one audio file per paragraph",
  sentence: "one audio file per sentence",
};

/** Runs an export from the UI, with its progress and result as a toast. */
export function exportWithToast(docId: string, split: ExportSplit = "none") {
  toast.promise(exportReader(docId, split), {
    loading: `Exporting ${SPLIT_LABEL[split]}...`,
    success: (result) =>
      "path" in result
        ? {
            message: "Audio exported",
            description: result.path,
            duration: 10_000,
          }
        : {
            message: `${result.parts.length} audio files exported`,
            description: result.directory,
            duration: 10_000,
          },
    error: (err: unknown) => (err instanceof Error ? err.message : String(err)),
  });
}
