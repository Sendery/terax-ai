import { createSelectionPopup } from "@/modules/ai/hooks/selectionPopup";
import {
  TERMINAL_SELECTION_GESTURE_EVENT,
  type TerminalSelectionGesture,
} from "@/modules/terminal/lib/selectionGesture";
import { useCallback, useEffect, useRef, useState } from "react";

type Params = {
  captureActiveSelection: () => string | null;
  askFromSelection: () => void;
  addSelectionToNote: () => void;
};

export function useSelectionAskAi({
  captureActiveSelection,
  askFromSelection,
  addSelectionToNote,
}: Params) {
  const [askPopup, setAskPopup] = useState<{ x: number; y: number } | null>(
    null,
  );
  const popup = useRef<ReturnType<typeof createSelectionPopup> | null>(null);

  useEffect(() => {
    const controller = createSelectionPopup({
      readSelection: captureActiveSelection,
      show: setAskPopup,
      defer: (run) => setTimeout(run, 0),
    });
    popup.current = controller;
    const isInsideAi = (target: EventTarget | null) => {
      const element = target as HTMLElement | null;
      return !!element?.closest?.(
        "[data-selection-ask-ai], [data-ai-input-bar], [data-ai-mini-window]",
      );
    };
    const onDown = (event: MouseEvent) => {
      if (!isInsideAi(event.target)) controller.dismiss();
    };
    const onUp = (event: MouseEvent) => {
      if (event.button !== 0 || isInsideAi(event.target)) return;
      const element = event.target as HTMLElement | null;
      if (!element?.closest?.(".cm-editor")) return;
      controller.legacy({ x: event.clientX, y: event.clientY });
    };
    const onNativeSelection = (event: Event) => {
      controller.native(
        (event as CustomEvent<TerminalSelectionGesture>).detail,
      );
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("mouseup", onUp);
    document.addEventListener(
      TERMINAL_SELECTION_GESTURE_EVENT,
      onNativeSelection,
    );
    return () => {
      controller.dispose();
      if (popup.current === controller) popup.current = null;
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener(
        TERMINAL_SELECTION_GESTURE_EVENT,
        onNativeSelection,
      );
    };
  }, [captureActiveSelection]);

  const runSelectionAction = useCallback((action: () => void) => {
    popup.current?.act(action);
  }, []);
  const onAskFromSelection = useCallback(() => {
    runSelectionAction(askFromSelection);
  }, [askFromSelection, runSelectionAction]);
  const onAddToNoteFromSelection = useCallback(() => {
    runSelectionAction(addSelectionToNote);
  }, [addSelectionToNote, runSelectionAction]);

  return {
    askPopup,
    setAskPopup,
    onAskFromSelection,
    onAddToNoteFromSelection,
    runSelectionAction,
  };
}
