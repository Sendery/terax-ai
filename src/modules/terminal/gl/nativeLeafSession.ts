import { NativeBlockInput } from "@/modules/terminal/gl/nativeBlockInput";
import {
  CELL_CODEPOINT_MASK,
  cellGrapheme,
  createRowView,
  readRow,
  type DecodedFrame,
} from "@/modules/terminal/gl/frameCodec";
import { createNativeSearch } from "@/modules/terminal/gl/nativeSearch";
import type { TerminalSearch } from "@/modules/terminal/lib/terminalSearch";
import {
  EngineSession,
  type EngineColors,
  type SessionObserver,
} from "@/modules/terminal/gl/engineSession";
import type { NativeState } from "@/modules/terminal/gl/nativeState";
import type { TerminalRenderer } from "@/modules/terminal/gl/gridRenderer";
import type { NativeLeaf } from "@/modules/terminal/gl/nativeLeafRegistry";
import { adaptGhosttyEngine } from "@/modules/terminal/lib/ghosttyEngine";
import { TerminalRetirement } from "@/modules/terminal/lib/terminalRetirement";
import {
  TerminalSessionController,
  type TerminalSize,
} from "@/modules/terminal/lib/terminalEngine";

export type NativeLeafConfig = {
  renderer: TerminalRenderer;
  size: TerminalSize;
  colors: EngineColors;
  cwd?: string;
  blocks?: boolean;
  onReady?: () => void;
  onResetReady?: () => void;
};
export type NativeLeafView = {
  onSession: (session: EngineSession | null) => void;
  onFrame: (frame?: DecodedFrame | null) => void;
  onDrawn?: (seq: number | null) => void;
  onError: (error: unknown) => void;
  onExit: (code: number) => void;
  onCwd?: (cwd: string) => void;
  focused: () => boolean;
  active?: () => boolean;
  focus: () => void;
};
type OpenNative = (
  renderer: TerminalRenderer,
  options: TerminalSize & {
    cwd?: string;
    blocks: boolean;
    colors: EngineColors;
    observer: SessionObserver;
  },
) => Promise<EngineSession>;

/** A leaf owns its process independently of React's pane layout. */
export class NativeLeafSession implements NativeLeaf {
  readonly blockInput: NativeBlockInput | null;
  private config: NativeLeafConfig;
  private owner!: TerminalSessionController;
  private native: EngineSession | null = null;
  private view: NativeLeafView | null = null;
  private readonly retirement = new TerminalRetirement();
  private closing: Promise<void> | null = null;
  private restarting: Promise<void> | null = null;
  private disposed = false;
  private generation = 0;
  private error: unknown = null;
  private pendingExit: number | null = null;
  private selectionRefresh = false;
  private state: NativeState | null = null;
  private searchAdapter: TerminalSearch | null = null;

  constructor(
    config: NativeLeafConfig,
    private readonly open: OpenNative = (renderer, options) =>
      EngineSession.open(renderer, options),
  ) {
    this.config = config;
    this.blockInput = config.blocks ? new NativeBlockInput() : null;
    this.start();
  }

  get submissionIdentity(): object {
    return this.owner;
  }
  get cwd(): string | null {
    return this.disposed ? null : (this.state?.cwd ?? null);
  }
  get shellReady(): boolean {
    return !this.exited && Boolean(this.state?.shellReady);
  }
  get commandRunning(): boolean {
    return !this.exited && Boolean(this.state?.commandRunning);
  }

  get opened(): Promise<void> {
    return this.owner.opened;
  }
  get id(): number | null {
    return this.disposed ? null : this.owner.id;
  }
  get exited(): boolean {
    return (
      this.disposed ||
      this.owner.exitCode !== null ||
      this.owner.failure !== null
    );
  }
  get focused(): boolean {
    return Boolean(
      this.view &&
        (this.view.active?.() ?? true) &&
        (this.view.focused() || this.blockInput?.focused),
    );
  }
  get tuiReady(): boolean {
    const state = this.native?.inputState;
    return (
      this.id !== null &&
      !this.exited &&
      Boolean(state && (state.modifyOtherKeys >= 1 || state.kittyFlags !== 0))
    );
  }
  get alternateScreen(): boolean {
    return this.native?.inputState?.alternateScreen ?? false;
  }
  getSelection(): string | null {
    return this.id !== null ? (this.native?.getSelection() ?? null) : null;
  }

  attach(view: NativeLeafView, config: NativeLeafConfig): () => void {
    if (this.disposed) throw new Error("Terminal is closed.");
    this.notifySession(null);
    this.view = view;
    this.configure(config);
    if (this.native && this.owner.id !== null) this.notifySession(this.native);
    if (this.error !== null) this.report(this.error);
    if (this.cwd) this.notifyCwd(this.cwd);
    this.deliverExit();
    return () => {
      if (this.view !== view) return;
      this.notifySession(null);
      this.view = null;
      this.hide();
    };
  }

  configure(config: NativeLeafConfig): void {
    this.config = config;
    this.owner.resize(config.size.cols, config.size.rows);
    if (!this.native || this.owner.id === null || this.closing) return;
    try {
      this.native.attachRenderer(config.renderer);
      this.native.setColors(config.colors);
    } catch (error) {
      this.report(error);
      void this.closeCurrent().catch(this.report);
    }
  }
  resize(cols: number, rows: number): void {
    this.config = { ...this.config, size: { cols, rows } };
    this.owner.resize(cols, rows);
  }
  write(text: string): boolean {
    return !this.disposed && this.owner.write(text);
  }
  focus(): void {
    if (!this.blockInput?.focus()) this.view?.focus();
  }
  repaint(): void {
    this.native?.requestFull(true);
  }

  async navigateBlocks(direction: -1 | 1): Promise<void> {
    const native = this.native;
    if (!this.blockInput || !native || this.id === null) return;
    try {
      await native.blockAction({ kind: "navigate", direction });
    } catch (error) {
      this.report(error);
    }
  }
  clearBlockSelection(): boolean {
    const native = this.native;
    if (!this.blockInput || !native || !this.getSelection()) return false;
    void native.select({ kind: "clear" }).catch(this.report);
    return true;
  }

  get search(): TerminalSearch {
    if (!this.searchAdapter) {
      const owner = this.owner;
      this.searchAdapter = createNativeSearch(async (command) => {
        await owner.opened;
        const native = this.native;
        if (
          this.owner !== owner ||
          !native ||
          this.id === null ||
          this.closing
        ) {
          if (command.kind === "clear") return false;
          throw new Error("Terminal search is no longer available.");
        }
        const found = await native.search(command);
        if (this.owner !== owner || this.native !== native || this.id === null)
          throw new Error("Terminal search is no longer available.");
        return found;
      });
    }
    return this.searchAdapter;
  }

  async readText(maxLines?: number): Promise<string | null> {
    const owner = this.owner;
    await owner.opened;
    await owner.settled();
    const native = this.native;
    if (!native || this.owner !== owner || this.id === null) return null;
    const text = await native.readText(maxLines);
    return this.owner === owner && this.id !== null ? text : null;
  }
  async encodeShiftEnter(): Promise<string> {
    const native = await this.requireNative();
    const sequence = await native.encodeKey({
      code: "Enter",
      mods: 1,
      legacyShiftEnter: true,
    });
    if (native !== this.native || this.id === null)
      throw new Error("Terminal is no longer available.");
    return sequence;
  }
  async pasteFromClipboard(
    read: () => Promise<string | null>,
    isCurrent: () => boolean = () => true,
  ): Promise<void> {
    const owner = this.owner;
    const native = this.native;
    const text = await read();
    if (
      !text ||
      !isCurrent() ||
      this.owner !== owner ||
      this.native !== native ||
      this.id === null ||
      this.exited
    )
      return;
    await this.paste(text);
  }
  async paste(text: string): Promise<void> {
    const native = await this.requireNative();
    native.scroll(2_147_483_647);
    await native.paste(text);
  }
  async submit(
    text: string,
    current: () => boolean = () => true,
  ): Promise<void> {
    if (this.blockInput && !text.trim()) return;
    const native = await this.requireNative();
    if (!current()) throw new Error("Terminal is no longer available.");
    const owner = this.owner;
    const generation = this.generation;
    const ticket = this.blockInput?.beginSubmit(text);
    try {
      native.scroll(2_147_483_647);
      await native.submit(
        text,
        () =>
          current() &&
          this.owner === owner &&
          this.generation === generation &&
          this.native === native &&
          !this.exited &&
          this.id !== null,
      );
      if (
        this.owner !== owner ||
        this.generation !== generation ||
        this.native !== native ||
        this.exited ||
        native.id === null
      )
        throw new Error("Terminal is no longer available.");
      if (ticket) this.blockInput?.acceptSubmit(ticket);
    } catch (error) {
      if (ticket) this.blockInput?.rejectSubmit(ticket);
      throw error;
    }
  }
  dispose(): Promise<void> {
    this.resetReady();
    this.disposed = true;
    this.blockInput?.dispose();
    this.notifySession(null);
    this.view = null;
    return this.closeCurrent();
  }
  respawn(cwd?: string): Promise<void> {
    if (this.disposed) return Promise.reject(new Error("Terminal is closed."));
    if (this.restarting) return this.restarting;
    this.resetReady();
    const nextCwd = cwd ?? this.cwd ?? this.config.cwd;
    this.restarting = this.closeCurrent()
      .then(async () => {
        if (this.disposed) throw new Error("Terminal closed while restarting.");
        this.config = { ...this.config, cwd: nextCwd };
        this.start();
        await this.opened;
      })
      .finally(() => {
        this.restarting = null;
      });
    return this.restarting;
  }

  private start(): void {
    const generation = ++this.generation;
    this.searchAdapter = null;
    const prerequisite = this.retirement.beforeOpen();
    this.native = null;
    this.closing = null;
    this.error = null;
    this.pendingExit = null;
    this.state = null;
    this.resetReady();
    const owner = new TerminalSessionController(
      async (size, observer) => {
        await prerequisite;
        if (this.disposed || generation !== this.generation)
          throw new Error("Terminal closed while opening.");
        const native = await this.open(this.config.renderer, {
          ...size,
          cwd: this.config.cwd,
          blocks: this.blockInput !== null,
          colors: this.config.colors,
          observer: {
            onState: (state) => {
              if (
                generation !== this.generation ||
                this.disposed ||
                this.closing ||
                this.owner.exitCode !== null ||
                this.owner.failure !== null
              )
                return;
              const previous = this.state;
              this.state = state;
              this.blockInput?.accept(state);
              if (state.cwd !== null && state.cwd !== previous?.cwd)
                this.notifyCwd(state.cwd);
              if (state.shellReady && !previous?.shellReady) {
                try {
                  this.config.onReady?.();
                } catch (error) {
                  this.report(error);
                }
              }
            },
            onError: observer.onError,
            onExit: observer.onExit,
            onDrawn: (_at, seq) => {
              if (generation !== this.generation || this.disposed) return;
              try {
                this.view?.onDrawn?.(seq);
              } catch (error) {
                this.report(error);
              }
            },
            onFrame: (event) => {
              if (generation !== this.generation || this.disposed) return;
              if (
                event.frame &&
                this.blockInput?.watermark !== "dead" &&
                this.blockInput
              ) {
                const frame = event.frame;
                const row = createRowView();
                outer: for (let index = 0; index < frame.rowCount; index++) {
                  readRow(frame, index, row);
                  for (let col = 0; col < row.cellCount; col++) {
                    const cell = frame.u32[row.cellsAt + col];
                    const value = cell & CELL_CODEPOINT_MASK;
                    if (
                      cellGrapheme(frame, cell) !== undefined ||
                      (value !== 0 && value !== 32)
                    ) {
                      this.blockInput.markContent();
                      break outer;
                    }
                  }
                }
              }
              try {
                this.view?.onFrame(event.frame);
              } catch (error) {
                this.report(error);
              }
              const session = this.native;
              if (
                !session ||
                session.getSelection() === null ||
                this.selectionRefresh
              )
                return;
              this.selectionRefresh = true;
              void session
                .select({ kind: "read" })
                .catch(this.report)
                .finally(() => {
                  this.selectionRefresh = false;
                });
            },
          },
        });
        this.native = native;
        this.config.renderer.setPaneFocused(native.pane, false);
        try {
          if (native.inputState === null) await native.readState();
          if (this.disposed || generation !== this.generation)
            throw new Error("Terminal closed while opening.");
          native.attachRenderer(this.config.renderer);
          native.setColors(this.config.colors);
        } catch (error) {
          await native.close();
          throw error;
        }
        return adaptGhosttyEngine(native);
      },
      this.config.size,
      {
        onError: (error) => {
          if (this.owner === owner && owner.failure) this.resetReady();
          this.report(error);
        },
        onExit: (code) => {
          if (generation !== this.generation || this.disposed) return;
          this.resetReady();
          this.pendingExit = code;
          this.deliverExit();
        },
      },
    );
    this.owner = owner;
    void owner.opened
      .then(() => {
        if (this.owner === owner && !this.disposed)
          this.notifySession(this.native);
      })
      .catch(() => {});
  }
  private readonly report = (error: unknown): void => {
    this.error = error;
    if (!this.disposed) {
      try {
        this.view?.onError(error);
      } catch {
        console.error("native terminal view error observer failed");
      }
    }
  };
  private deliverExit(): void {
    if (!this.view || this.pendingExit === null) return;
    const code = this.pendingExit;
    this.pendingExit = null;
    try {
      this.view.onExit(code);
    } catch (error) {
      this.report(error);
    }
  }
  private resetReady(): void {
    this.blockInput?.reset();
    try {
      this.config.onResetReady?.();
    } catch (error) {
      this.report(error);
    }
  }
  private notifyCwd(cwd: string): void {
    try {
      this.view?.onCwd?.(cwd);
    } catch (error) {
      this.report(error);
    }
  }
  private notifySession(session: EngineSession | null): void {
    try {
      this.view?.onSession(session);
    } catch (error) {
      this.report(error);
      if (session) void this.closeCurrent().catch(this.report);
    }
  }
  private hide(): void {
    if (!this.native) return;
    this.config.renderer.setPaneFocused(this.native.pane, false);
    this.config.renderer.setPaneRect(this.native.pane, {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    });
  }
  private closeCurrent(): Promise<void> {
    if (this.closing) return this.closing;
    this.generation++;
    this.notifySession(null);
    this.hide();
    const native = this.native;
    this.closing = this.retirement.track(
      Promise.all([
        native?.close() ?? Promise.resolve(),
        this.owner.close(),
      ]).then(() => {}),
    );
    return this.closing;
  }
  private async requireNative(): Promise<EngineSession> {
    const owner = this.owner;
    await owner.opened;
    if (this.owner !== owner || this.id === null || !this.native || this.exited)
      throw new Error("Terminal is no longer available.");
    return this.native;
  }
}
