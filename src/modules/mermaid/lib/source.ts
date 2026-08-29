export const MAX_MERMAID_SOURCE_BYTES = 48 * 1024;
export const MAX_MERMAID_LIVE_PREVIEW_BYTES = 24 * 1024;

export type MermaidSourceValidation =
  | { ok: true; source: string }
  | { ok: false; message: string };

const FENCED_MERMAID = /^```(?:mermaid|mmd)[^\S\n]*\n([\s\S]*?)\n```$/i;

export function mermaidSourceByteLength(source: string): number {
  return new TextEncoder().encode(source).byteLength;
}

export function canLivePreviewMermaidSource(source: string): boolean {
  return mermaidSourceByteLength(source) <= MAX_MERMAID_LIVE_PREVIEW_BYTES;
}

export function normalizeMermaidSource(source: string): string {
  const normalized = source.replace(/\r\n?/g, "\n").trim();
  const fenced = normalized.match(FENCED_MERMAID);
  return (fenced?.[1] ?? normalized).trim();
}

export function validateMermaidDraftSource(
  source: string,
): MermaidSourceValidation {
  if (mermaidSourceByteLength(source) > MAX_MERMAID_SOURCE_BYTES) {
    return {
      ok: false,
      message: `Mermaid source exceeds ${MAX_MERMAID_SOURCE_BYTES} UTF-8 bytes`,
    };
  }
  return { ok: true, source };
}

export function validateMermaidSource(source: string): MermaidSourceValidation {
  const normalized = normalizeMermaidSource(source);
  const draft = validateMermaidDraftSource(normalized);
  if (!draft.ok) return draft;
  if (!draft.source) {
    return { ok: false, message: "Mermaid source cannot be empty" };
  }
  return draft;
}
