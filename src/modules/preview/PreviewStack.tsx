import { LinkedTabPane, useLinkedTabs } from "@/modules/tabs/LinkedTabPane";
import { linkedSide } from "@/modules/tabs/lib/linkedTabs";
import type { PreviewTab, Tab } from "@/modules/tabs";
import { useEffect, useRef } from "react";
import { PreviewPane, type PreviewPaneHandle } from "./PreviewPane";

type Props = {
  tabs: Tab[];
  activeId: number;
  onUrlChange: (id: number, url: string) => void;
  registerHandle: (id: number, handle: PreviewPaneHandle | null) => void;
};

export function PreviewStack({
  tabs,
  activeId,
  onUrlChange,
  registerHandle,
}: Props) {
  const linked = useLinkedTabs();
  const previews = tabs.filter(
    (t): t is PreviewTab => t.kind === "preview" && !t.cold,
  );

  const registerRef = useRef(registerHandle);
  const urlChangeRef = useRef(onUrlChange);
  useEffect(() => {
    registerRef.current = registerHandle;
  }, [registerHandle]);
  useEffect(() => {
    urlChangeRef.current = onUrlChange;
  }, [onUrlChange]);

  const refCallbacks = useRef(
    new Map<number, (h: PreviewPaneHandle | null) => void>(),
  );
  const urlCallbacks = useRef(new Map<number, (url: string) => void>());

  const getRefCallback = (id: number) => {
    let cb = refCallbacks.current.get(id);
    if (!cb) {
      cb = (h: PreviewPaneHandle | null) => registerRef.current(id, h);
      refCallbacks.current.set(id, cb);
    }
    return cb;
  };
  const getUrlCallback = (id: number) => {
    let cb = urlCallbacks.current.get(id);
    if (!cb) {
      cb = (url: string) => urlChangeRef.current(id, url);
      urlCallbacks.current.set(id, cb);
    }
    return cb;
  };

  useEffect(() => {
    const live = new Set(previews.map((t) => t.id));
    for (const id of refCallbacks.current.keys()) {
      if (!live.has(id)) refCallbacks.current.delete(id);
    }
    for (const id of urlCallbacks.current.keys()) {
      if (!live.has(id)) urlCallbacks.current.delete(id);
    }
  }, [previews]);

  if (previews.length === 0) return null;
  return (
    <div className="relative h-full w-full">
      {previews.map((t) => {
        const active = t.id === activeId;
        const visible = active || !!linkedSide(linked?.link, t.id);
        return (
          <LinkedTabPane key={t.id} tabId={t.id} active={active}>
            <PreviewPane
              ref={getRefCallback(t.id)}
              url={t.url}
              visible={visible}
              onUrlChange={getUrlCallback(t.id)}
            />
          </LinkedTabPane>
        );
      })}
    </div>
  );
}
