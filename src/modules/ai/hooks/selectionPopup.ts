import type { TerminalSelectionGesture } from "@/modules/terminal/lib/selectionGesture";

type Position = { x: number; y: number };
export function createSelectionPopup(options: {
  readSelection: () => string | null;
  show: (position: Position | null) => void;
  defer: (run: () => void) => void;
}) {
  let disposed = false;
  let version = 0;
  let nativeCurrent: (() => boolean) | null = null;
  const dismiss = () => {
    version++;
    nativeCurrent = () => false;
    options.show(null);
  };
  return {
    dismiss,
    legacy(position: Position) {
      const ticket = ++version;
      nativeCurrent = null;
      options.defer(() => {
        if (disposed || ticket !== version) return;
        options.show(options.readSelection()?.trim() ? position : null);
      });
    },
    native(gesture: TerminalSelectionGesture) {
      const ticket = ++version;
      nativeCurrent = () => false;
      options.show(null);
      const current = () =>
        !disposed && ticket === version && gesture.current();
      void gesture.selection.then(
        (text) => {
          if (!current()) return;
          const valid = () => current() && options.readSelection() === text;
          nativeCurrent = valid;
          options.show(
            text?.trim() && valid() ? { x: gesture.x, y: gesture.y } : null,
          );
        },
        () => {
          if (disposed || ticket !== version) return;
          nativeCurrent = () => false;
          options.show(null);
        },
      );
    },
    act(action: () => void) {
      try {
        if (!disposed && (!nativeCurrent || nativeCurrent())) action();
      } finally {
        dismiss();
      }
    },
    dispose() {
      disposed = true;
      version++;
      if (nativeCurrent) options.show(null);
      nativeCurrent = null;
    },
  };
}
