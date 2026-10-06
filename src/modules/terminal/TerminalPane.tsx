import { IS_MAC } from "@/lib/platform";
import { useTheme } from "@/modules/theme";
import type { SearchAddon } from "@xterm/addon-search";
import {
  forwardRef,
  memo,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import { BlockOverlay } from "./block/BlockOverlay";
import { BlockWatermark } from "./block/BlockWatermark";
import {
  TerminalContextMenu,
  type ReadAloudOptions,
  type TerminalSelectionActions,
} from "./TerminalContextMenu";
import {
  focusLeafInput,
  submitToLeaf,
  useTerminalSession,
} from "./lib/useTerminalSession";
import { isSecondaryClick } from "./lib/pointer";

export type TerminalPaneHandle = {
  write: (data: string) => void;
  focus: () => void;
  /** Newline encoding the foreground program negotiated, for synthesized
   *  multiline input that must not submit early. */
  shiftEnter: () => string;
  getBuffer: (maxLines?: number) => string | null;
  getSelection: () => string | null;
};

type Props = {
  /** Stable identifier for this leaf (passed back through callbacks). */
  leafId: number;
  /** Tab containing this pane is on screen. */
  visible: boolean;
  /** This leaf is the active pane within its tab — receives auto-focus. */
  focused?: boolean;
  initialCwd?: string;
  homePath?: string | null;
  /** Enable command-block decorations (OSC 133) for this terminal. */
  blocks?: boolean;
  onSearchReady?: (leafId: number, addon: SearchAddon) => void;
  onExit?: (leafId: number, code: number) => void;
  onCwd?: (leafId: number, cwd: string) => void;
  onOpenFileLink?: (path: string) => void;
  onReadAloud?: (text: string, options: ReadAloudOptions) => void;
  onStopReading?: () => void;
  /** Ask Terax / Add to Note / Open Mermaid, shared with the selection popup. */
  selectionActions?: TerminalSelectionActions;
  /** Hides Read aloud, the same way a private terminal is hidden from AI. */
  privateTerminal?: boolean;
};

export const TerminalPane = memo(
  forwardRef<TerminalPaneHandle, Props>(function TerminalPane(
    {
      leafId,
      visible,
      focused = true,
      initialCwd,
      homePath,
      blocks = false,
      onSearchReady,
      onExit,
      onCwd,
      onOpenFileLink,
      onReadAloud,
      onStopReading,
      selectionActions,
      privateTerminal = false,
    },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const downYRef = useRef<number | null>(null);
    const menuSelectionRef = useRef<string | null>(null);
    const preClickSelectionRef = useRef<string | null>(null);
    const { resolvedMode, activeTheme } = useTheme();

    const session = useTerminalSession({
      leafId,
      container: containerRef,
      visible,
      focused,
      initialCwd,
      homePath,
      blocks,
      onSearchReady: (a) => onSearchReady?.(leafId, a),
      onExit: (c) => onExit?.(leafId, c),
      onCwd: (c) => onCwd?.(leafId, c),
      onOpenFileLink,
    });

    useEffect(() => {
      // Defer one frame so CSS-variable token resolution sees the new class.
      const id = requestAnimationFrame(() => session.applyTheme());
      return () => cancelAnimationFrame(id);
    }, [resolvedMode, activeTheme, session]);

    useImperativeHandle(
      ref,
      () => ({
        write: (data: string) => session.write(data),
        focus: () => session.focus(),
        shiftEnter: () => session.shiftEnter(),
        getBuffer: (max?: number) => session.getBuffer(max),
        getSelection: () => session.getSelection(),
      }),
      [session],
    );

    const hideStyle = {
      visibility: visible ? ("visible" as const) : ("hidden" as const),
      pointerEvents: visible ? ("auto" as const) : ("none" as const),
    };

    // A right-click over a selection keeps it; only with nothing selected does
    // xterm pick the word or link under the pointer. The pre-click text is the
    // fallback for the paths that still clear it, such as Ctrl+click on macOS.
    const captureMenuSelection = (event: {
      button: number;
      ctrlKey: boolean;
    }) => {
      if (!isSecondaryClick(event, IS_MAC)) return;
      preClickSelectionRef.current = session.getSelection();
      session.prepareContextMenu();
    };
    const onMenuOpen = () => {
      menuSelectionRef.current =
        session.getSelection() ?? preClickSelectionRef.current;
      preClickSelectionRef.current = null;
    };
    const menuProps = {
      leafId,
      readSelection: () => menuSelectionRef.current,
      onReadAloud,
      onStopReading,
      selectionActions,
      onRestoreFocus: () => {
        // In a blocks pane the editor, not the grid, holds focus at the prompt.
        // Focusing the grid would move the caret out of the input the user was
        // typing in, so a right-click would cost them their place.
        if (blocks && session.blockMode === "prompt") focusLeafInput(leafId);
        else session.focus();
      },
      privateTerminal,
    };

    const promptReady = session.blockMode === "prompt";

    if (blocks) {
      return (
        <TerminalContextMenu {...menuProps}>
          {/* biome-ignore lint/a11y/noStaticElementInteractions: terminal surface; the pointer handlers only snapshot the selection for the context menu */}
          <div
            className="zoom-exempt flex h-full w-full flex-col"
            style={hideStyle}
            onMouseDownCapture={captureMenuSelection}
            onContextMenu={onMenuOpen}
          >
            <div className="relative min-h-0 flex-1">
              {/* biome-ignore lint/a11y/noStaticElementInteractions: terminal surface; pointer selects command blocks */}
              <div
                ref={containerRef}
                className="absolute inset-0 z-0"
                // Selecting a block is a primary-button gesture. The secondary
                // button only opens the context menu: letting it through here
                // moved the block selection and the focus out from under the
                // menu that was opening.
                onMouseDown={(e) => {
                  if (e.button !== 0) return;
                  downYRef.current = e.clientY;
                }}
                onMouseUp={(e) => {
                  if (e.button !== 0) return;
                  const moved =
                    downYRef.current != null &&
                    Math.abs(e.clientY - downYRef.current) > 4;
                  downYRef.current = null;
                  if (!moved) session.selectBlockAt(e.clientY);
                  if (session.blockMode === "prompt") focusLeafInput(leafId);
                }}
              />
              <BlockWatermark
                leafId={leafId}
                subscribe={session.subscribeBlocks}
              />
              <BlockOverlay
                subscribe={session.subscribeBlocks}
                getVisible={session.visibleBlocks}
                readOutput={(id) => session.readBlockId(id)?.output ?? null}
                searchBlock={session.searchBlock}
                revealMatch={session.revealMatch}
                clearSearch={session.clearSearch}
                promptReady={promptReady}
                onRunAgain={(cmd) => submitToLeaf(leafId, cmd)}
                onRestoreFocus={() => {
                  if (session.blockMode === "prompt") focusLeafInput(leafId);
                }}
              />
            </div>
          </div>
        </TerminalContextMenu>
      );
    }

    return (
      <TerminalContextMenu {...menuProps}>
        {/* biome-ignore lint/a11y/noStaticElementInteractions: terminal surface; the pointer handlers only snapshot the selection for the context menu */}
        <div
          ref={containerRef}
          className="zoom-exempt h-full w-full"
          style={hideStyle}
          onMouseDownCapture={captureMenuSelection}
          onContextMenu={onMenuOpen}
        />
      </TerminalContextMenu>
    );
  }),
);
