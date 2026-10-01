import type { MermaidVisualLayout } from "@/modules/tabs";
import { validateMermaidDraftSource } from "./source";
import {
  classifyMermaidVisualSource,
  type MermaidVisualDocument,
  serializeMermaidVisualDocument,
} from "./visualDocument";

export type PreparedMermaidVisualTransaction = {
  source: string;
  visualLayout?: MermaidVisualLayout;
};

export async function prepareMermaidVisualTransaction(
  document: MermaidVisualDocument,
  validateRuntime: (source: string) => Promise<void>,
): Promise<PreparedMermaidVisualTransaction> {
  const serialized = serializeMermaidVisualDocument(document);
  const validation = validateMermaidDraftSource(serialized);
  if (!validation.ok) throw new Error(validation.message);

  const visualLayout =
    document.kind === "flowchart" ? document.layout : undefined;
  const reparsed = classifyMermaidVisualSource(validation.source, visualLayout);
  if (reparsed.status !== "editable") {
    throw new Error(
      `Generated source is not visually editable: ${reparsed.reason}`,
    );
  }
  if (reparsed.document.kind !== document.kind) {
    throw new Error("Generated source changed Mermaid diagram type");
  }

  await validateRuntime(validation.source);
  return { source: validation.source, visualLayout };
}
