import { registerNativeCaptureProvider } from "@/modules/capture/lib/captureLease";
import { captureNativePane } from "@/modules/terminal/gl/nativeCaptureProvider";
import { minimumTerminalContrast } from "@/modules/terminal/gl/minimumContrast";
import {
  RenderCapacityError,
  RENDER_CAPACITY_MESSAGE,
} from "@/modules/terminal/gl/renderCapacity";
import { NativeBlockView } from "@/modules/terminal/gl/nativeBlockView";
import { BlockOverlay } from "@/modules/terminal/block/BlockOverlay";
import { BlockWatermark } from "@/modules/terminal/block/BlockWatermark";
import {
  bindNativeLinks,
  type NativeLinkBinding,
} from "@/modules/terminal/gl/nativeLinkBinding";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { registerCanvasSnapshotProvider } from "@/modules/capture/lib/rasterize";
import type { EngineSession } from "@/modules/terminal/gl/engineSession";
import {
  bindNativeInput,
  type NativeInputBinding,
} from "@/modules/terminal/gl/nativeInputBinding";
import {
  registerNativeLeaf,
  getNativeLeaf,
} from "@/modules/terminal/gl/nativeLeafRegistry";
import { nativePaneLayout } from "@/modules/terminal/gl/nativeSurface";
import {
  markSessionReady,
  resetSessionReady,
} from "@/modules/terminal/lib/useTerminalSession";
import { NativeLeafSession } from "@/modules/terminal/gl/nativeLeafSession";
import { readTerminalClipboard } from "@/modules/terminal/lib/terminalClipboard";
import { isSecondaryClick } from "@/modules/terminal/lib/pointer";
import { IS_MAC } from "@/lib/platform";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { useNativeTerminalSurface } from "@/modules/terminal/gl/nativeSurfaceContext";
import { TerminalContextMenu } from "@/modules/terminal/TerminalContextMenu";
import type {
  TerminalPaneHandle,
  TerminalPaneProps,
} from "@/modules/terminal/TerminalPane";

const noSubscription = () => () => {};

export const NativeTerminalPane = forwardRef<
  TerminalPaneHandle,
  TerminalPaneProps
>(function NativeTerminalPane(props, ref) {
  const surface = useNativeTerminalSurface();
  const cursorBlink = usePreferencesStore((state) => state.terminalCursorBlink);
  const scrollbackRows = usePreferencesStore(
    (state) => state.terminalScrollback,
  );
  const scrollbackRowsRef = useRef(scrollbackRows);
  scrollbackRowsRef.current = scrollbackRows;
  const cursorBlinkRef = useRef(cursorBlink);
  cursorBlinkRef.current = cursorBlink;
  const surfaceRef = useRef(surface);
  surfaceRef.current = surface;
  const latest = useRef(props);
  latest.current = props;
  const host = useRef<HTMLDivElement>(null);
  const paneRoot = useRef<HTMLDivElement>(null);
  const engine = useRef<EngineSession | null>(null);
  const controller = useRef<NativeLeafSession | null>(null);
  const input = useRef<NativeInputBinding | null>(null);
  const links = useRef<NativeLinkBinding | null>(null);
  const lastHomePath = useRef(props.homePath);
  const adapter = useRef<NativeLeafSession | null>(null);
  const selectedForMenu = useRef<string | null>(null);
  const preClickSelection = useRef<string | null>(null);
  const replayContextMenu = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const capacityError = useRef(false);
  const [blocksView, setBlocksView] = useState<{
    view: NativeBlockView;
    session: EngineSession;
    owner: NativeLeafSession;
  } | null>(null);
  const blockMode = useSyncExternalStore(
    blocksView?.owner.blockInput?.subscribe ?? noSubscription,
    () => blocksView?.owner.blockInput?.mode ?? "running",
    () => "running",
  );
  const renderer = surface?.renderer ?? null;
  const { leafId, visible, focused = true } = props;

  useEffect(() => {
    const model = surfaceRef.current;
    const element = host.current;
    if (!renderer || !model || !element) return;
    let disposed = false;
    let binding: NativeInputBinding | null = null;
    let linkBinding: NativeLinkBinding | null = null;
    let unsubscribeInput: () => void = () => {};
    let native: EngineSession | null = null;
    let blockView: NativeBlockView | null = null;
    let layoutFrame = 0;
    const report = (cause: unknown) => {
      if (!disposed && cause instanceof RenderCapacityError)
        capacityError.current = true;
      if (!disposed)
        setError(cause instanceof Error ? cause.message : String(cause));
    };
    setError(null);
    capacityError.current = false;
    const initialBox = element.getBoundingClientRect();
    const rootBox = model.root.current?.getBoundingClientRect() ?? initialBox;
    const initial =
      initialBox.width > 0 && initialBox.height > 0
        ? nativePaneLayout(initialBox, rootBox, renderer.cellSize).grid
        : { cols: 80, rows: 24 };
    const config = {
      renderer,
      size: initial,
      colors: model.colors.engine,
      cursorBlink: cursorBlinkRef.current,
      scrollbackRows: scrollbackRowsRef.current,
      cwd: latest.current.initialCwd,
      blocks: latest.current.blocks ?? false,
      onReady: () => markSessionReady(leafId),
      onResetReady: () => resetSessionReady(leafId),
    };
    const existing = getNativeLeaf(leafId);
    if (existing && !(existing instanceof NativeLeafSession)) {
      report(new Error("Terminal leaf has a different owner."));
      return;
    }
    const owner = existing ?? new NativeLeafSession(config);
    if (!existing) registerNativeLeaf(leafId, owner);
    controller.current = owner;
    adapter.current = owner;
    const measure = () => {
      layoutFrame = 0;
      const root = model.root.current;
      if (disposed || !root) return;
      const box = element.getBoundingClientRect();
      if (box.width <= 0 || box.height <= 0) {
        if (native)
          renderer.setPaneRect(native.pane, {
            x: 0,
            y: 0,
            width: 0,
            height: 0,
          });
        return;
      }
      const layout = nativePaneLayout(
        box,
        root.getBoundingClientRect(),
        renderer.cellSize,
      );
      owner.resize(layout.grid.cols, layout.grid.rows);
      if (native)
        native.setCellPixels(
          renderer.cellPixels.width,
          renderer.cellPixels.height,
        );
      if (native)
        renderer.setPaneRect(
          native.pane,
          latest.current.visible
            ? layout.rect
            : { ...layout.rect, width: 0, height: 0 },
        );
      binding?.updateCursor();
      linkBinding?.updateLayout();
      blockView?.layout();
    };
    const scheduleLayout = () => {
      if (!layoutFrame && !disposed)
        layoutFrame = requestAnimationFrame(measure);
    };
    const captureProxy = document.createElement("canvas");
    captureProxy.width = 1;
    captureProxy.height = 1;
    captureProxy.setAttribute("aria-hidden", "true");
    captureProxy.setAttribute("data-terax-capture-required", "");
    captureProxy.tabIndex = -1;
    captureProxy.style.cssText =
      "position:absolute;left:6px;top:6px;width:calc(100% - 12px);height:calc(100% - 12px);opacity:0;pointer-events:none;";
    element.append(captureProxy);
    const unregisterCapture = registerCanvasSnapshotProvider(
      captureProxy,
      () =>
        !disposed && latest.current.visible && native
          ? renderer.snapshot(native.pane)
          : null,
    );
    const captureRoot = paneRoot.current;
    const unregisterNativeCapture = captureRoot
      ? registerNativeCaptureProvider(captureRoot, async (scope) => {
          const session = native;
          const currentSurface = surfaceRef.current;
          if (!session || !currentSurface)
            throw new Error("Native terminal capture is unavailable.");
          const identity = owner.submissionIdentity;
          const id = session.id;
          const appearanceKey = () => {
            const surface = surfaceRef.current;
            const prefs = usePreferencesStore.getState();
            const style = window.getComputedStyle(captureRoot);
            return JSON.stringify({
              font: surface?.font,
              colors: surface?.colors,
              contrast: minimumTerminalContrast(
                prefs.backgroundKind,
                prefs.backgroundImageId,
              ),
              dpr: window.devicePixelRatio || 1,
              cell: renderer.cellSize,
              focused: session.pane.focused,
              blocks: latest.current.blocks ?? false,
              css: [
                style.font,
                style.color,
                style.backgroundColor,
                document.documentElement.getAttribute("class"),
                document.documentElement.getAttribute("style"),
              ],
            });
          };
          const key = appearanceKey();
          const current = () =>
            !disposed &&
            scope.current() &&
            !latest.current.visible &&
            !latest.current.privateTerminal &&
            latest.current.leafId === leafId &&
            paneRoot.current === captureRoot &&
            getNativeLeaf(leafId) === owner &&
            controller.current === owner &&
            owner.submissionIdentity === identity &&
            native === session &&
            engine.current === session &&
            id !== null &&
            session.id === id &&
            surfaceRef.current?.renderer === renderer &&
            appearanceKey() === key;
          const box = captureProxy.getBoundingClientRect();
          const prefs = usePreferencesStore.getState();
          return captureNativePane({
            root: captureRoot,
            canvas: captureProxy,
            session,
            blocks: latest.current.blocks ?? false,
            promptReady: () => owner.blockInput?.mode === "prompt",
            appearance: {
              font: { ...currentSurface.font },
              background: currentSurface.colors.background,
              cursorFallback: currentSurface.colors.cursor,
              minimumContrastRatio: minimumTerminalContrast(
                prefs.backgroundKind,
                prefs.backgroundImageId,
              ),
              width: box.width,
              height: box.height,
              dpr: window.devicePixelRatio || 1,
              cellSize: { ...renderer.cellSize },
              focused: session.pane.focused,
            },
            scope: { signal: scope.signal, current },
          });
        })
      : () => {};
    const detach = owner.attach(
      {
        onSession: (session) => {
          blockView?.dispose();
          blockView = null;
          if (!disposed) setBlocksView(null);
          if (input.current === binding) input.current = null;
          unsubscribeInput();
          unsubscribeInput = () => {};
          binding?.dispose();
          linkBinding?.dispose();
          if (links.current === linkBinding) links.current = null;
          linkBinding = null;
          binding = null;
          native = session;
          engine.current = session;
          if (disposed || !session) return;
          const current = surfaceRef.current ?? model;
          if (owner.blockInput) {
            blockView = new NativeBlockView({
              session,
              input: owner.blockInput,
              available: () =>
                !disposed &&
                latest.current.visible &&
                controller.current === owner &&
                engine.current === session &&
                session.historyAvailable,
              metrics: () => ({ height: renderer.cellSize.height, padding: 6 }),
              onError: report,
            });
            setBlocksView({ view: blockView, session, owner });
          }
          binding = bindNativeInput(session, renderer, element, {
            font: current.font,
            foreground: current.colors.engine.foreground,
            background: current.colors.engine.background,
            isActive: () =>
              latest.current.visible && Boolean(latest.current.focused ?? true),
            onError: report,
            allowInput: () => owner.blockInput?.directInput ?? true,
            focusPrompt: () => {
              owner.blockInput?.focus();
            },
            onBlockClick: owner.blockInput
              ? async (seq, row) => {
                  if (
                    disposed ||
                    !latest.current.visible ||
                    engine.current !== session
                  )
                    return;
                  await session.blockAction({ kind: "selectAt", seq, row });
                }
              : undefined,
          });
          input.current = binding;
          unsubscribeInput =
            owner.blockInput?.subscribe(() => binding?.updateInputPolicy()) ??
            (() => {});
          linkBinding = bindNativeLinks(session, renderer, element, {
            available: () =>
              !disposed &&
              latest.current.visible &&
              engine.current === session &&
              session.historyAvailable,
            active: () =>
              latest.current.visible && Boolean(latest.current.focused ?? true),
            cwd: () => owner.cwd ?? latest.current.initialCwd,
            home: () => latest.current.homePath,
            foreground: () =>
              (surfaceRef.current ?? model).colors.engine.foreground,
            openFile: (path, location) =>
              latest.current.onOpenFileLink?.(path, location),
            focus: () => binding?.focus(),
          });
          links.current = linkBinding;
          latest.current.onSearchReady?.(leafId, owner.search);
          measure();
          blockView?.present(session.drawnSeq);
          if (latest.current.visible && (latest.current.focused ?? true))
            binding.focus();
        },
        onFrame: (frame) => {
          binding?.updateCursor();
          linkBinding?.onFrame(frame);
        },
        onDrawn: (seq) => {
          if (seq !== null && capacityError.current) {
            capacityError.current = false;
            setError((value) =>
              value === RENDER_CAPACITY_MESSAGE ? null : value,
            );
          }
          linkBinding?.onDrawn();
          blockView?.present(seq);
        },
        onHistoryChange: () => {
          linkBinding?.invalidate();
          blockView?.present(native?.drawnSeq ?? null);
          blockView?.layout();
        },
        onError: report,
        onExit: (code) => latest.current.onExit?.(leafId, code),
        onCwd: (cwd) => {
          linkBinding?.invalidate();
          latest.current.onCwd?.(leafId, cwd);
        },
        focus: () => binding?.focus(),
        active: () =>
          latest.current.visible && Boolean(latest.current.focused ?? true),
        focused: () =>
          latest.current.visible &&
          Boolean(latest.current.focused ?? true) &&
          Boolean(paneRoot.current?.contains(document.activeElement)),
      },
      config,
    );
    const resize = new ResizeObserver(scheduleLayout);
    resize.observe(element);
    const unsubscribe = model.subscribeLayout(scheduleLayout);
    void owner.opened.catch(report);
    return () => {
      disposed = true;
      blockView?.dispose();
      detach();
      unregisterNativeCapture();
      unregisterCapture();
      captureProxy.remove();
      unsubscribe();
      resize.disconnect();
      if (layoutFrame) cancelAnimationFrame(layoutFrame);
      if (controller.current === owner) controller.current = null;
      if (adapter.current === owner) adapter.current = null;
    };
  }, [renderer, leafId]);

  useEffect(() => {
    const session = engine.current;
    const model = surfaceRef.current;
    const element = host.current;
    if (!session || !renderer || !model || !element || !model.root.current)
      return;
    const layout = nativePaneLayout(
      element.getBoundingClientRect(),
      model.root.current.getBoundingClientRect(),
      renderer.cellSize,
    );
    renderer.setPaneRect(
      session.pane,
      visible ? layout.rect : { ...layout.rect, width: 0, height: 0 },
    );
    renderer.setPaneFocused(
      session.pane,
      visible && focused && document.hasFocus(),
    );
    blocksView?.view.present(session.drawnSeq);
    if (visible && focused) input.current?.focus();
  }, [visible, focused, renderer, blocksView]);
  useEffect(() => {
    if (!visible || !focused) links.current?.invalidate();
  }, [visible, focused]);
  useEffect(() => {
    if (lastHomePath.current === props.homePath) return;
    lastHomePath.current = props.homePath;
    links.current?.invalidate();
  }, [props.homePath]);
  useEffect(() => {
    if (!surface) return;
    engine.current?.setColors(surface.colors.engine);
    links.current?.updateLayout();
    input.current?.updateAppearance({
      font: surface.font,
      foreground: surface.colors.engine.foreground,
      background: surface.colors.engine.background,
    });
  }, [surface]);

  useEffect(() => {
    controller.current?.setCursorBlink(cursorBlink);
  }, [cursorBlink]);

  useEffect(() => {
    controller.current?.setScrollbackRows(scrollbackRows);
  }, [scrollbackRows]);

  useImperativeHandle(
    ref,
    () => ({
      write: (text) => {
        if (latest.current.leafId === leafId) controller.current?.write(text);
      },
      focus: () => controller.current?.focus(),
      shiftEnter: () => {
        const owner = controller.current;
        if (!owner || latest.current.leafId !== leafId)
          return Promise.reject(new Error("Terminal is not ready."));
        return owner.encodeShiftEnter();
      },
      getBuffer: (maxLines) => {
        const owner = controller.current;
        if (!owner || latest.current.leafId !== leafId) return null;
        return owner.readText(maxLines);
      },
      getSelection: () =>
        controller.current?.id !== null && latest.current.leafId === leafId
          ? (engine.current?.getSelection() ?? null)
          : null,
    }),
    [leafId],
  );

  const restoreFocus = () => {
    if (latest.current.visible && (latest.current.focused ?? true))
      controller.current?.focus();
  };
  const pasteFromMenu = () => {
    const target = adapter.current;
    if (!target) return;
    void target
      .pasteFromClipboard(
        readTerminalClipboard,
        () => adapter.current === target,
      )
      .catch((cause) => setError(String(cause)));
  };
  const onContextMenuCapture = (event: React.MouseEvent<HTMLDivElement>) => {
    if (replayContextMenu.current) {
      replayContextMenu.current = false;
      return;
    }
    const saved = preClickSelection.current;
    preClickSelection.current = null;
    if (saved !== null) {
      selectedForMenu.current = saved;
      return;
    }
    event.preventDefault();
    const owner = controller.current;
    const originalSession = engine.current;
    const element = host.current;
    if (!owner || !element) return;
    const { clientX, clientY, button, ctrlKey } = event;
    void (async () => {
      await owner.opened;
      const session = engine.current;
      if (
        !session ||
        session !== originalSession ||
        controller.current !== owner ||
        !latest.current.visible
      )
        return;
      const selected = await session.select({ kind: "read" });
      if (!selected) await input.current?.wordAt(clientX, clientY);
      if (
        controller.current !== owner ||
        engine.current !== session ||
        !element.isConnected ||
        !latest.current.visible
      )
        return;
      selectedForMenu.current = session.getSelection();
      replayContextMenu.current = true;
      element.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX,
          clientY,
          button,
          ctrlKey,
        }),
      );
    })().catch((cause) => setError(String(cause)));
  };
  return (
    <TerminalContextMenu
      leafId={leafId}
      readSelection={() => selectedForMenu.current}
      onReadAloud={props.onReadAloud}
      onStopReading={props.onStopReading}
      selectionActions={props.selectionActions}
      privateTerminal={props.privateTerminal}
      onRestoreFocus={restoreFocus}
      onPaste={pasteFromMenu}
      onRedraw={() => adapter.current?.repaint()}
    >
      <div
        ref={paneRoot}
        data-native-terminal-leaf={leafId}
        data-terminal-engine="ghostty"
        className="zoom-exempt relative h-full w-full overflow-hidden"
        style={{
          visibility: visible ? "visible" : "hidden",
          pointerEvents: visible ? "auto" : "none",
        }}
      >
        <div
          ref={host}
          data-native-terminal-grid=""
          className="absolute inset-0"
          onMouseDownCapture={(event) => {
            if (isSecondaryClick(event, IS_MAC))
              preClickSelection.current =
                engine.current?.getSelection() ?? null;
          }}
          onContextMenuCapture={onContextMenuCapture}
        />
        {blocksView && props.blocks && (
          <>
            <BlockWatermark
              leafId={leafId}
              subscribe={blocksView.view.subscribe}
            />
            <BlockOverlay
              key={blocksView.session.id}
              actionOwner={blocksView.session}
              active={visible}
              available={() => engine.current === blocksView.session}
              privateTerminal={props.privateTerminal}
              subscribe={blocksView.view.subscribe}
              getVisible={blocksView.view.visible}
              readOutput={blocksView.view.readOutput}
              searchBlock={blocksView.view.searchBlock}
              revealMatch={blocksView.view.revealMatch}
              clearSearch={blocksView.view.clearSearch}
              promptReady={blockMode === "prompt"}
              onRunAgain={(command) => blocksView.owner.submit(command)}
              onRestoreFocus={restoreFocus}
            />
          </>
        )}
        {(error ?? surface?.error) && (
          <div
            role="alert"
            data-terax-capture-foreground=""
            className="absolute inset-x-2 bottom-2 z-10 rounded bg-background/95 p-2 text-xs text-destructive"
          >
            {error ?? surface?.error}
          </div>
        )}
      </div>
    </TerminalContextMenu>
  );
});
