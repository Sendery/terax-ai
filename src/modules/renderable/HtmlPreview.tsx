import {
  parseStaticHtml,
  staticHtmlDocument,
} from "@/modules/renderable/staticHtml";
import { useMemo } from "react";
export function HtmlPreview({ source }: { source: string }) {
  const result = useMemo(() => {
    try {
      return { srcDoc: staticHtmlDocument(parseStaticHtml(source)) };
    } catch (error) {
      return {
        error:
          error instanceof Error ? error.message : "HTML preview unavailable",
      };
    }
  }, [source]);
  if (result.error)
    return (
      <p role="alert" className="p-3 text-xs text-destructive">
        {result.error}. The raw file remains editable.
      </p>
    );
  return (
    <div className="flex h-full min-h-0 flex-col">
      <p className="shrink-0 border-b border-border px-3 py-1 text-[11px] text-muted-foreground">
        Static HTML. Scripts, navigation and external or relative resources are
        disabled.
      </p>
      <iframe
        title="Rendered HTML"
        sandbox=""
        referrerPolicy="no-referrer"
        srcDoc={result.srcDoc}
        className="min-h-0 w-full flex-1 border-0 bg-white"
      />
    </div>
  );
}
