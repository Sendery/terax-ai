import { buildSharedExtensions } from "@/modules/editor/lib/extensions";
import { useEditorThemeExt } from "@/modules/editor/lib/useEditorThemeExt";
import { EditorView } from "@codemirror/view";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { useMemo, useRef } from "react";
import { GraphJsonTools } from "./GraphJsonTools";
import { graphJsonExtensions } from "./lib/jsonEditing";

export function GraphJsonEditor({
  source,
  onChange,
}: {
  source: string;
  onChange: (source: string) => void;
}) {
  const ref = useRef<ReactCodeMirrorRef>(null);
  const theme = useEditorThemeExt();
  const extensions = useMemo(
    () => [
      ...buildSharedExtensions(),
      ...graphJsonExtensions(),
      EditorView.contentAttributes.of({
        "aria-label": "GraphX JSON source",
        spellcheck: "false",
      }),
    ],
    [],
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded border border-border zoom-exempt">
      <GraphJsonTools source={source} getView={() => ref.current?.view} />
      <CodeMirror
        ref={ref}
        value={source}
        onChange={onChange}
        theme={theme}
        extensions={extensions}
        height="100%"
        className="terax-code-editor min-h-0 flex-1 overflow-hidden"
      />
    </div>
  );
}
