//! Terminal engine (`docs/architecture/terminal-engine.md`). One libghostty
//! `Terminal` per session, owned by its own thread, fed through a bounded
//! queue and drained into frames only while the webview holds out a credit.
//!
//! `frame` and the pump bookkeeping in `Pump` are pure and build without the
//! `ghostty-engine` feature; everything that touches libghostty is gated.

pub mod frame;
#[cfg(any(test, feature = "ghostty-engine"))]
mod health;
#[cfg(any(test, feature = "ghostty-engine"))]
pub mod shell;
#[cfg(any(test, feature = "ghostty-engine"))]
pub use health::{final_exit_code, EngineFailure, ENGINE_FAILED_EXIT};

#[cfg(feature = "ghostty-engine")]
pub mod bench;
#[cfg(feature = "ghostty-engine")]
pub mod block_actions;
#[cfg(feature = "ghostty-engine")]
pub mod blocks;
#[cfg(any(test, feature = "ghostty-engine"))]
mod clipboard;
#[cfg(feature = "ghostty-engine")]
mod cursor;
#[cfg(feature = "ghostty-engine")]
mod graphics;
#[cfg(feature = "ghostty-engine")]
pub mod input;
#[cfg(any(test, feature = "ghostty-engine"))]
mod keyboard_modes;
#[cfg(feature = "ghostty-engine")]
pub mod links;
#[cfg(feature = "ghostty-engine")]
pub mod search;
#[cfg(feature = "ghostty-engine")]
pub mod selection;
#[cfg(feature = "ghostty-engine")]
mod snapshot;
#[cfg(feature = "ghostty-engine")]
pub mod state;
#[cfg(feature = "ghostty-engine")]
mod text;

#[cfg(feature = "ghostty-engine")]
pub use runtime::*;

use std::time::{Duration, Instant};

/// Bytes messages queued between the PTY reader and the engine. Each holds one
/// read (at most 16 KiB), so a full queue is 128 KiB; past that the reader
/// blocks, the kernel buffer fills and the child blocks.
pub const QUEUE_DEPTH: usize = 8;
pub const MIN_FRAME_INTERVAL: Duration = Duration::from_millis(4);
pub const MAX_COLS: u16 = 1000;
pub const MAX_ROWS: u16 = 500;
// Pinned Ghostty interprets max_scrollback as bytes, despite its C/Rust docs.
// Pages grow lazily; this bounds history, not a dimension-independent row count.
pub const SCROLLBACK_BYTES: usize = 16 * 1024 * 1024;

pub fn validate_size(cols: u16, rows: u16) -> Result<(), String> {
    if cols == 0 || rows == 0 || cols > MAX_COLS || rows > MAX_ROWS {
        return Err(format!(
            "invalid terminal size {cols}x{rows} (1..={MAX_COLS} x 1..={MAX_ROWS})"
        ));
    }
    Ok(())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Decision {
    Idle,
    Wait(Duration),
    Now,
}

/// Credit and timing bookkeeping of the frame pump: one frame in flight, a
/// frame only when something changed, at most one per `MIN_FRAME_INTERVAL`.
#[derive(Debug)]
pub struct Pump {
    has_credit: bool,
    last_seq: u32,
    full_pending: bool,
    output_pending: bool,
    last_frame_at: Option<Instant>,
    waiting_since: Option<Instant>,
    credit_wait: Duration,
    credits: u64,
}

impl Default for Pump {
    fn default() -> Self {
        Self::new()
    }
}

impl Pump {
    /// A session starts with one credit and a pending full frame.
    pub fn new() -> Self {
        Self {
            has_credit: true,
            last_seq: 0,
            full_pending: true,
            output_pending: false,
            last_frame_at: None,
            waiting_since: None,
            credit_wait: Duration::ZERO,
            credits: 0,
        }
    }

    pub fn output(&mut self) {
        self.output_pending = true;
    }

    pub fn request_full(&mut self) {
        self.full_pending = true;
    }

    pub fn full_pending(&self) -> bool {
        self.full_pending
    }

    pub fn has_pending(&self) -> bool {
        self.full_pending || self.output_pending
    }

    pub fn credit_wait(&self) -> Duration {
        self.credit_wait
    }

    pub fn credits(&self) -> u64 {
        self.credits
    }

    pub fn next_seq(&self) -> u32 {
        self.last_seq.wrapping_add(1).max(1)
    }

    /// Accepts the credit only for the frame in flight, so a duplicate or
    /// stale acknowledgement can never put a second frame in flight.
    pub fn credit(&mut self, seq: u32, now: Instant) -> bool {
        if self.has_credit || self.last_seq == 0 || seq != self.last_seq {
            return false;
        }
        self.has_credit = true;
        self.credits += 1;
        if let Some(since) = self.waiting_since.take() {
            self.credit_wait += now.saturating_duration_since(since);
        }
        true
    }

    pub fn decide(&mut self, now: Instant) -> Decision {
        if !self.has_pending() {
            return Decision::Idle;
        }
        if !self.has_credit {
            self.waiting_since.get_or_insert(now);
            return Decision::Idle;
        }
        match self.last_frame_at {
            Some(at) if now < at + MIN_FRAME_INTERVAL => {
                Decision::Wait(at + MIN_FRAME_INTERVAL - now)
            }
            _ => Decision::Now,
        }
    }

    pub fn sent(&mut self, now: Instant) {
        self.last_seq = self.next_seq();
        self.has_credit = false;
        self.last_frame_at = Some(now);
        self.full_pending = false;
        self.output_pending = false;
    }

    /// The snapshot found nothing to send; the credit stays.
    pub fn nothing_changed(&mut self) {
        self.output_pending = false;
    }
}

#[cfg(feature = "ghostty-engine")]
mod runtime {
    use std::cell::RefCell;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::mpsc::{sync_channel, Receiver, RecvTimeoutError, SyncSender, TrySendError};
    use std::sync::{Arc, Mutex, PoisonError};
    use std::thread::{self, JoinHandle};
    use std::time::Instant;

    use libghostty_vt::terminal::{
        ConformanceLevel, DeviceAttributeFeature, DeviceAttributes, DeviceType,
        PrimaryDeviceAttributes, ScrollViewport, SecondaryDeviceAttributes,
        TertiaryDeviceAttributes,
    };
    use libghostty_vt::{Terminal, TerminalOptions};
    use serde::Serialize;

    use super::super::colors::Colors;
    use super::health::EngineHealth;
    use super::snapshot::Snapshotter;
    use super::EngineFailure;
    use super::{validate_size, Decision, Pump, QUEUE_DEPTH, SCROLLBACK_BYTES};

    // The same answers the xterm.js path gives today (`da_filter.rs`), so a
    // program sees one terminal identity whichever engine runs the pane.
    const DEVICE_ATTRIBUTES: DeviceAttributes = DeviceAttributes {
        primary: PrimaryDeviceAttributes::new(ConformanceLevel(1), &[DeviceAttributeFeature(2)]),
        secondary: SecondaryDeviceAttributes {
            device_type: DeviceType(0),
            firmware_version: 276,
            rom_cartridge: 0,
        },
        tertiary: TertiaryDeviceAttributes { unit_id: 0 },
    };

    /// Returns false once the receiver is gone; the engine then stops framing.
    pub type FrameSink = Box<dyn FnMut(Vec<u8>) -> bool + Send>;
    /// Bytes the terminal answers with (device attributes, cursor reports).
    pub type ReplySink = Box<dyn FnMut(&[u8]) + Send>;

    pub type FinishReceiver = Receiver<Result<(), EngineFailure>>;

    pub(super) enum Input {
        Bytes(Vec<u8>),
        Wake,
        Finish(SyncSender<Result<(), EngineFailure>>),
        Encode(
            super::input::InputEvent,
            SyncSender<Result<Vec<u8>, String>>,
        ),
        Shutdown,
    }

    #[derive(Default, PartialEq, Eq)]
    enum InputState {
        #[default]
        Accepting,
        Finished,
        Closed,
    }

    // Commands from the webview never wait on the byte queue: they land here,
    // coalesced, and a non-blocking wake makes the engine look.
    pub type TextReply = Result<String, String>;
    pub type TextReceiver = Receiver<TextReply>;
    pub type SelectionReply = Result<Option<String>, String>;
    pub type SelectionReceiver = Receiver<SelectionReply>;
    pub type SearchReply = Result<bool, String>;
    pub type SearchReceiver = Receiver<SearchReply>;
    struct SearchRequest {
        command: super::search::SearchCommand,
        reply: SyncSender<SearchReply>,
    }
    pub type LinkReply = Result<Option<super::links::LinkContext>, String>;
    pub type LinkReceiver = Receiver<LinkReply>;
    struct LinkRequest {
        seq: u32,
        col: u16,
        row: u16,
        reply: SyncSender<LinkReply>,
    }
    pub type BlockSnapshotReceiver = Receiver<Result<super::blocks::BlockSnapshot, String>>;
    pub type BlockOutputReceiver = Receiver<Result<Option<super::blocks::BlockOutput>, String>>;
    pub type BlockActionReceiver = Receiver<Result<super::block_actions::BlockReply, String>>;
    enum BlockRequest {
        Action {
            command: super::block_actions::BlockCommand,
            reply: SyncSender<Result<super::block_actions::BlockReply, String>>,
        },
        Snapshot {
            seq: Option<u32>,
            reply: SyncSender<Result<super::blocks::BlockSnapshot, String>>,
        },
        Read {
            id: String,
            reply: SyncSender<Result<Option<super::blocks::BlockOutput>, String>>,
        },
    }
    impl BlockRequest {
        fn reject(self, error: &str) {
            match self {
                Self::Action { reply, .. } => {
                    let _ = reply.try_send(Err(error.into()));
                }
                Self::Snapshot { reply, .. } => {
                    let _ = reply.try_send(Err(error.into()));
                }
                Self::Read { reply, .. } => {
                    let _ = reply.try_send(Err(error.into()));
                }
            }
        }
    }
    const MAX_TEXT_REQUESTS: usize = 32;

    struct TextRequest {
        lines: u16,
        reply: SyncSender<TextReply>,
    }

    struct SelectionRequest {
        command: super::selection::SelectionCommand,
        reply: SyncSender<SelectionReply>,
    }

    // Accepted work outlives an IPC receipt timeout. Selection and block
    // requests must retain one arrival order across that boundary.
    enum InteractionRequest {
        Selection(SelectionRequest),
        Block(BlockRequest),
    }
    impl InteractionRequest {
        fn reject(self, error: &str) {
            match self {
                Self::Selection(request) => {
                    let _ = request.reply.try_send(Err(error.into()));
                }
                Self::Block(request) => request.reject(error),
            }
        }
    }

    #[derive(Default)]
    struct Control {
        ack: Option<u32>,
        resize: Option<(u16, u16, u32, u32)>,
        cell_pixels: Option<(u32, u32)>,
        colors: Option<Colors>,
        cursor_blink: Option<bool>,
        scroll: i64,
        full: bool,
        stop: bool,
        text_requests: Vec<TextRequest>,
        interaction_requests: Vec<InteractionRequest>,
        search_requests: Vec<SearchRequest>,
        link_requests: Vec<LinkRequest>,
        text_pending: usize,
        text_closed: bool,
    }

    impl Control {
        fn take(&mut self) -> Self {
            let current = std::mem::take(self);
            self.text_pending = current.text_pending;
            self.text_closed = current.text_closed;
            current
        }
    }

    fn reject_text_requests(control: &Mutex<Control>) {
        let pending = {
            let mut control = control.lock().unwrap_or_else(PoisonError::into_inner);
            control.text_closed = true;
            control.text_pending = 0;
            (
                std::mem::take(&mut control.text_requests),
                std::mem::take(&mut control.interaction_requests),
                std::mem::take(&mut control.search_requests),
                std::mem::take(&mut control.link_requests),
            )
        };
        for request in pending.0 {
            let _ = request.reply.try_send(Err("terminal engine closed".into()));
        }
        for request in pending.1 {
            request.reject("terminal engine closed");
        }
        for request in pending.2 {
            let _ = request.reply.try_send(Err("terminal engine closed".into()));
        }
        for request in pending.3 {
            let _ = request.reply.try_send(Err("terminal engine closed".into()));
        }
    }

    #[derive(Default)]
    struct Stats {
        clipboard: super::clipboard::ClipboardMailbox,
        input_state: super::state::StateStore,
        bytes_fed: AtomicU64,
        frames: AtomicU64,
        frame_bytes: AtomicU64,
        encode_micros: AtomicU64,
        send_micros: AtomicU64,
        credit_wait_micros: AtomicU64,
        credits: AtomicU64,
        scrollback_rows: AtomicU64,
    }

    #[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct EngineStats {
        pub bytes_fed: u64,
        pub frames: u64,
        pub frame_bytes: u64,
        pub encode_micros: u64,
        pub send_micros: u64,
        pub credit_wait_micros: u64,
        pub credits: u64,
        pub scrollback_rows: Option<u64>,
    }

    /// The webview side of a session: credits, size, scroll. Never blocks.
    #[derive(Clone)]
    pub struct EngineHandle {
        wake: SyncSender<Input>,
        control: Arc<Mutex<Control>>,
        stats: Arc<Stats>,
        health: Arc<EngineHealth>,
    }

    impl EngineHandle {
        pub fn read_text(&self, lines: u16) -> Result<TextReceiver, String> {
            super::text::validate_lines(lines)?;
            let (reply, receiver) = sync_channel(1);
            {
                let mut control = self.control.lock().unwrap_or_else(PoisonError::into_inner);
                if control.text_closed || self.health.failure().is_some() {
                    return Err("terminal engine is unavailable".into());
                }
                if control.text_pending >= MAX_TEXT_REQUESTS {
                    return Err("too many pending terminal text requests".into());
                }
                control.text_pending += 1;
                control.text_requests.push(TextRequest { lines, reply });
            }
            if matches!(
                self.wake.try_send(Input::Wake),
                Err(TrySendError::Disconnected(_))
            ) {
                return Err("terminal engine closed".into());
            }
            Ok(receiver)
        }

        pub fn selection(
            &self,
            command: super::selection::SelectionCommand,
        ) -> Result<SelectionReceiver, String> {
            command.validate()?;
            let (reply, receiver) = sync_channel(1);
            {
                let mut control = self.control.lock().unwrap_or_else(PoisonError::into_inner);
                if control.text_closed || self.health.failure().is_some() {
                    return Err("terminal engine is unavailable".into());
                }
                if control.text_pending >= MAX_TEXT_REQUESTS {
                    return Err("too many pending terminal queries".into());
                }
                control.text_pending += 1;
                control
                    .interaction_requests
                    .push(InteractionRequest::Selection(SelectionRequest {
                        command,
                        reply,
                    }));
            }
            if matches!(
                self.wake.try_send(Input::Wake),
                Err(TrySendError::Disconnected(_))
            ) {
                return Err("terminal engine closed".into());
            }
            Ok(receiver)
        }

        pub fn search(
            &self,
            command: super::search::SearchCommand,
        ) -> Result<SearchReceiver, String> {
            command.validate()?;
            let (reply, receiver) = sync_channel(1);
            {
                let mut control = self.control.lock().unwrap_or_else(PoisonError::into_inner);
                if control.text_closed || self.health.failure().is_some() {
                    return Err("terminal engine is unavailable".into());
                }
                if control.text_pending >= MAX_TEXT_REQUESTS {
                    return Err("too many pending terminal queries".into());
                }
                control.text_pending += 1;
                control
                    .search_requests
                    .push(SearchRequest { command, reply });
            }
            if matches!(
                self.wake.try_send(Input::Wake),
                Err(TrySendError::Disconnected(_))
            ) {
                return Err("terminal engine closed".into());
            }
            Ok(receiver)
        }

        pub fn link_context(&self, seq: u32, col: u16, row: u16) -> Result<LinkReceiver, String> {
            if seq == 0 || col >= super::MAX_COLS || row >= super::MAX_ROWS {
                return Err("invalid terminal link coordinates".into());
            }
            let (reply, receiver) = sync_channel(1);
            {
                let mut control = self.control.lock().unwrap_or_else(PoisonError::into_inner);
                if control.text_closed || self.health.failure().is_some() {
                    return Err("terminal engine is unavailable".into());
                }
                if control.text_pending >= MAX_TEXT_REQUESTS {
                    return Err("too many pending terminal queries".into());
                }
                control.text_pending += 1;
                control.link_requests.push(LinkRequest {
                    seq,
                    col,
                    row,
                    reply,
                });
            }
            if matches!(
                self.wake.try_send(Input::Wake),
                Err(TrySendError::Disconnected(_))
            ) {
                return Err("terminal engine closed".into());
            }
            Ok(receiver)
        }

        pub fn blocks(&self) -> Result<BlockSnapshotReceiver, String> {
            self.block_snapshot(None)
        }
        pub fn blocks_for_frame(&self, seq: u32) -> Result<BlockSnapshotReceiver, String> {
            if seq == 0 {
                return Err("invalid terminal block frame".into());
            }
            self.block_snapshot(Some(seq))
        }
        fn block_snapshot(&self, seq: Option<u32>) -> Result<BlockSnapshotReceiver, String> {
            let (reply, receiver) = sync_channel(1);
            self.queue_block(BlockRequest::Snapshot { seq, reply })?;
            Ok(receiver)
        }
        pub fn read_block(&self, id: String) -> Result<BlockOutputReceiver, String> {
            super::blocks::validate_id(&id)?;
            let (reply, receiver) = sync_channel(1);
            self.queue_block(BlockRequest::Read { id, reply })?;
            Ok(receiver)
        }
        pub fn block_action(
            &self,
            command: super::block_actions::BlockCommand,
        ) -> Result<BlockActionReceiver, String> {
            command.validate()?;
            let (reply, receiver) = sync_channel(1);
            self.queue_block(BlockRequest::Action { command, reply })?;
            Ok(receiver)
        }
        fn queue_block(&self, request: BlockRequest) -> Result<(), String> {
            {
                let mut control = self.control.lock().unwrap_or_else(PoisonError::into_inner);
                if control.text_closed || self.health.failure().is_some() {
                    return Err("terminal engine is unavailable".into());
                }
                if control.text_pending >= MAX_TEXT_REQUESTS {
                    return Err("too many pending terminal queries".into());
                }
                control.text_pending += 1;
                control
                    .interaction_requests
                    .push(InteractionRequest::Block(request));
            }
            if matches!(
                self.wake.try_send(Input::Wake),
                Err(TrySendError::Disconnected(_))
            ) {
                return Err("terminal engine closed".into());
            }
            Ok(())
        }
        pub fn take_clipboard_write(&self) -> Option<String> {
            if self.health.failure().is_some() {
                return None;
            }
            self.stats.clipboard.take()
        }

        pub fn on_clipboard(&self, listener: impl Fn() -> bool + Send + Sync + 'static) {
            self.stats.clipboard.subscribe(listener);
        }

        pub fn input_state(&self) -> super::state::EngineState {
            self.stats.input_state.snapshot()
        }
        pub fn on_state(
            &self,
            listener: impl Fn(super::state::EngineState) -> bool + Send + Sync + 'static,
        ) {
            if !self.stats.input_state.subscribe(Arc::new(listener)) {
                self.health.fail(EngineFailure::StateChannelClosed);
            }
        }

        pub fn failure(&self) -> Option<EngineFailure> {
            self.health.failure()
        }

        pub fn request_stop(&self) {
            self.stats.clipboard.close();
            self.update(|control| control.stop = true);
        }

        pub fn on_failure(&self, listener: impl FnOnce(EngineFailure) + Send + 'static) {
            self.health.subscribe(Box::new(listener));
        }

        pub fn credit(&self, seq: u32) {
            self.update(|c| c.ack = Some(seq));
        }

        pub fn set_colors(&self, colors: Colors) {
            self.update(|c| c.colors = Some(colors));
        }

        pub fn set_cursor_blink(&self, enabled: bool) {
            self.update(|control| control.cursor_blink = Some(enabled));
        }

        pub fn resize(&self, cols: u16, rows: u16) {
            self.resize_pixels(cols, rows, 8, 16);
        }

        pub fn resize_pixels(&self, cols: u16, rows: u16, width: u32, height: u32) {
            self.update(|c| c.queue_resize(cols, rows, width, height));
        }

        pub fn set_cell_pixels(&self, width: u32, height: u32) {
            self.update(|c| c.queue_cell_pixels(width, height));
        }

        pub fn scroll(&self, delta: i32) {
            self.update(|c| c.scroll = c.scroll.saturating_add(i64::from(delta)));
        }

        pub fn request_full(&self) {
            self.update(|c| c.full = true);
        }

        pub fn stats(&self) -> EngineStats {
            let s = &self.stats;
            let scrollback_rows = s.scrollback_rows.load(Ordering::Acquire);
            EngineStats {
                bytes_fed: s.bytes_fed.load(Ordering::Relaxed),
                frames: s.frames.load(Ordering::Relaxed),
                frame_bytes: s.frame_bytes.load(Ordering::Relaxed),
                encode_micros: s.encode_micros.load(Ordering::Relaxed),
                send_micros: s.send_micros.load(Ordering::Relaxed),
                credit_wait_micros: s.credit_wait_micros.load(Ordering::Relaxed),
                credits: s.credits.load(Ordering::Relaxed),
                scrollback_rows: (scrollback_rows != u64::MAX).then_some(scrollback_rows),
            }
        }

        fn update(&self, f: impl FnOnce(&mut Control)) {
            f(&mut self.control.lock().unwrap_or_else(PoisonError::into_inner));
            // A full queue means the engine is awake and reads the control
            // state after every message, so a dropped wake loses nothing.
            let _ = self.wake.try_send(Input::Wake);
        }
    }

    /// The producer side: PTY output in arrival order, then shutdown.
    #[derive(Clone)]
    pub struct EngineInput {
        tx: SyncSender<Input>,
        gate: Arc<Mutex<InputState>>,
    }

    impl EngineInput {
        /// Blocks while the queue is full. False when the engine is gone.
        pub fn feed(&self, bytes: Vec<u8>) -> bool {
            let gate = self.gate.lock().unwrap_or_else(PoisonError::into_inner);
            if *gate != InputState::Accepting {
                return false;
            }
            self.tx.send(Input::Bytes(bytes)).is_ok()
        }

        /// Ordered after accepted output. This may block on the bounded queue:
        /// call only from a producer worker, never the actor or a UI thread.
        pub fn encode_input(
            &self,
            event: super::input::InputEvent,
        ) -> Result<Receiver<Result<Vec<u8>, String>>, String> {
            event.validate()?;
            let gate = self.gate.lock().unwrap_or_else(PoisonError::into_inner);
            if *gate != InputState::Accepting {
                return Err("terminal input is already finished".into());
            }
            let (reply, receiver) = sync_channel(1);
            self.tx
                .send(Input::Encode(event, reply))
                .map_err(|_| "terminal engine closed")?;
            Ok(receiver)
        }

        /// Call from the producer after its output is drained, never from the actor itself.
        pub fn finish(&self) -> Result<FinishReceiver, String> {
            let mut gate = self.gate.lock().unwrap_or_else(PoisonError::into_inner);
            if *gate != InputState::Accepting {
                return Err("terminal input is already finished".into());
            }
            let (reply, receiver) = sync_channel(1);
            *gate = InputState::Finished;
            if self.tx.send(Input::Finish(reply)).is_err() {
                *gate = InputState::Closed;
                return Err("terminal engine closed".into());
            }
            Ok(receiver)
        }

        /// Queued behind every byte already fed, so the final frame shows them.
        pub fn shutdown(&self) {
            let mut gate = self.gate.lock().unwrap_or_else(PoisonError::into_inner);
            if *gate == InputState::Closed {
                return;
            }
            *gate = InputState::Closed;
            let _ = self.tx.send(Input::Shutdown);
        }
    }

    pub struct EngineThread {
        thread: JoinHandle<()>,
        health: Arc<EngineHealth>,
    }

    impl EngineThread {
        pub fn join(self) -> Result<(), EngineFailure> {
            if self.thread.join().is_err() {
                self.health.fail(EngineFailure::Panicked);
            }
            self.health.failure().map_or(Ok(()), Err)
        }
    }

    pub struct Engine {
        pub handle: EngineHandle,
        pub input: EngineInput,
        pub thread: EngineThread,
    }

    #[cfg(test)]
    pub fn start(
        cols: u16,
        rows: u16,
        frames: FrameSink,
        replies: ReplySink,
    ) -> Result<Engine, String> {
        start_with_colors(cols, rows, None, frames, replies)
    }

    #[derive(Default)]
    pub struct Appearance {
        pub colors: Option<Colors>,
        pub cursor_blink: bool,
    }

    pub fn start_with_colors(
        cols: u16,
        rows: u16,
        colors: Option<Colors>,
        frames: FrameSink,
        replies: ReplySink,
    ) -> Result<Engine, String> {
        start_config(
            cols,
            rows,
            Appearance {
                colors,
                ..Appearance::default()
            },
            None,
            false,
            frames,
            replies,
        )
    }

    pub struct ShellConfig {
        pub token: super::shell::ShellToken,
        pub blocks: bool,
    }
    impl From<super::shell::ShellToken> for ShellConfig {
        fn from(token: super::shell::ShellToken) -> Self {
            Self {
                token,
                blocks: false,
            }
        }
    }

    pub fn start_with_shell(
        cols: u16,
        rows: u16,
        colors: Option<Colors>,
        config: impl Into<ShellConfig>,
        frames: FrameSink,
        replies: ReplySink,
    ) -> Result<Engine, String> {
        start_with_shell_appearance(
            cols,
            rows,
            Appearance {
                colors,
                ..Appearance::default()
            },
            config,
            frames,
            replies,
        )
    }

    pub fn start_with_shell_appearance(
        cols: u16,
        rows: u16,
        appearance: Appearance,
        config: impl Into<ShellConfig>,
        frames: FrameSink,
        replies: ReplySink,
    ) -> Result<Engine, String> {
        let config = config.into();
        start_config(
            cols,
            rows,
            appearance,
            Some(config.token.into_string()),
            config.blocks,
            frames,
            replies,
        )
    }

    fn start_config(
        cols: u16,
        rows: u16,
        appearance: Appearance,
        shell_token: Option<String>,
        blocks_enabled: bool,
        frames: FrameSink,
        replies: ReplySink,
    ) -> Result<Engine, String> {
        validate_size(cols, rows)?;
        let (tx, rx) = sync_channel(QUEUE_DEPTH);
        let (ready_tx, ready_rx) = sync_channel(1);
        let control = Arc::new(Mutex::new(Control::default()));
        let stats = Arc::new(Stats::default());
        let health = Arc::new(EngineHealth::default());
        let thread = {
            let control = control.clone();
            let stats = stats.clone();
            let health = health.clone();
            thread::Builder::new()
                .name("terax-pty-engine".into())
                .spawn(move || {
                    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                        run(
                            cols,
                            rows,
                            appearance,
                            shell_token,
                            blocks_enabled,
                            &rx,
                            control.clone(),
                            stats.clone(),
                            frames,
                            replies,
                            ready_tx,
                            health.clone(),
                        );
                    }));
                    stats.clipboard.close();
                    if result.is_err() {
                        health.fail(EngineFailure::Panicked);
                    }
                    reject_text_requests(&control);
                })
                .map_err(|e| format!("spawn engine thread: {e}"))?
        };
        match ready_rx.recv() {
            Ok(Ok(())) => {}
            Ok(Err(e)) => {
                let _ = thread.join();
                return Err(e);
            }
            Err(_) => {
                let _ = thread.join();
                return Err("terminal engine failed to start".into());
            }
        }
        Ok(Engine {
            handle: EngineHandle {
                wake: tx.clone(),
                control,
                stats,
                health: health.clone(),
            },
            input: EngineInput {
                tx,
                gate: Arc::new(Mutex::new(InputState::Accepting)),
            },
            thread: EngineThread { thread, health },
        })
    }

    impl Control {
        fn queue_resize(&mut self, cols: u16, rows: u16, width: u32, height: u32) {
            self.resize = Some((cols, rows, width, height));
            self.cell_pixels = None;
        }
        fn queue_cell_pixels(&mut self, width: u32, height: u32) {
            if let Some((cols, rows, _, _)) = self.resize {
                self.resize = Some((cols, rows, width, height));
                self.cell_pixels = None;
            } else {
                self.cell_pixels = Some((width, height));
            }
        }
    }

    fn block_time() -> u64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
            .try_into()
            .unwrap_or(u64::MAX)
    }
    struct Session<'cb> {
        term: Terminal<'static, 'cb>,
        snapshot: Snapshotter,
        pump: Pump,
        size: (u16, u16),
        cell_pixels: (u32, u32),
        frames: FrameSink,
        sink_open: bool,
        health: Arc<EngineHealth>,
        replies: &'cb RefCell<Vec<u8>>,
        reply_sink: Option<ReplySink>,
        input_finished: bool,
        stop_requested: bool,
        selection: super::selection::SelectionState,
        search: super::search::SearchState,
        keyboard_modes: super::keyboard_modes::KeyboardModes,
        shell: super::shell::ShellIntegration,
        blocks: Option<super::blocks::BlockStore>,
        block_frames: Option<super::blocks::BlockFrames>,
        block_actions: Option<super::block_actions::BlockActions>,
        control: Arc<Mutex<Control>>,
        stats: Arc<Stats>,
    }

    impl Session<'_> {
        fn feed(&mut self, bytes: &[u8]) {
            self.keyboard_modes.ingest(bytes);
            if let Some(blocks) = &mut self.blocks {
                if let Err(error) =
                    blocks.feed(&mut self.term, &mut self.shell, bytes, block_time())
                {
                    log::warn!("terminal block tracking failed: {error}");
                    self.health.fail(EngineFailure::SnapshotFailed);
                }
            } else {
                self.shell.ingest(bytes);
                if let Err(error) = super::graphics::write(&mut self.term, bytes) {
                    log::warn!("terminal graphics policy failed: {error}");
                    self.health.fail(EngineFailure::SnapshotFailed);
                }
            }
            self.search.invalidate();
            self.update_input_state();
            self.update_scrollback_rows();
            self.flush_replies();
            self.stats
                .bytes_fed
                .fetch_add(bytes.len() as u64, Ordering::Relaxed);
            self.pump.output();
        }

        fn update_input_state(&self) {
            if self.health.failure().is_some() {
                return;
            }
            match super::state::Modes::read(&self.term, self.keyboard_modes.modify_other_keys()) {
                Ok(modes) => {
                    if !self.stats.input_state.publish(
                        modes,
                        self.shell.state(),
                        self.blocks.as_ref().map(|blocks| blocks.metadata_version()),
                    ) {
                        self.health.fail(EngineFailure::StateChannelClosed);
                    }
                }
                Err(error) => {
                    log::error!("terminal input state query failed: {error}");
                    self.health.fail(EngineFailure::SnapshotFailed);
                }
            }
        }

        fn update_scrollback_rows(&self) {
            let rows = self
                .term
                .scrollback_rows()
                .map(|rows| rows as u64)
                .unwrap_or_else(|e| {
                    log::warn!("terminal engine scrollback query failed: {e}");
                    u64::MAX
                });
            self.stats.scrollback_rows.store(rows, Ordering::Release);
        }

        fn flush_replies(&mut self) {
            let mut buf = self.replies.borrow_mut();
            if !buf.is_empty() {
                if let Some(sink) = self.reply_sink.as_mut() {
                    sink(&buf);
                }
                buf.clear();
            }
        }

        fn apply_control(&mut self) {
            let c = self
                .control
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .take();
            if c.stop {
                self.stop_requested = true;
                for request in c.text_requests {
                    let _ = request.reply.try_send(Err("terminal engine closed".into()));
                }
                for request in c.interaction_requests {
                    request.reject("terminal engine closed");
                }
                for request in c.search_requests {
                    let _ = request.reply.try_send(Err("terminal engine closed".into()));
                }
                for request in c.link_requests {
                    let _ = request.reply.try_send(Err("terminal engine closed".into()));
                }
                reject_text_requests(&self.control);
                self.reply_sink.take();
                *self.replies.borrow_mut() = Vec::new();
                return;
            }
            if let Some((cols, rows, width, height)) = c.resize {
                if ((cols, rows) != self.size || (width, height) != self.cell_pixels)
                    && validate_size(cols, rows).is_ok()
                {
                    match self.term.resize(cols, rows, width, height) {
                        Ok(()) => {
                            self.size = (cols, rows);
                            self.cell_pixels = (width, height);
                            self.snapshot.set_cell_pixels(width, height);
                            self.search.invalidate();
                            self.update_scrollback_rows();
                            self.pump.request_full();
                            self.flush_replies();
                        }
                        Err(e) => log::warn!("terminal engine resize to {cols}x{rows} failed: {e}"),
                    }
                }
            }
            if let Some((width, height)) = c.cell_pixels {
                if (width, height) != self.cell_pixels {
                    match self.term.resize(self.size.0, self.size.1, width, height) {
                        Ok(()) => {
                            self.cell_pixels = (width, height);
                            self.snapshot.set_cell_pixels(width, height);
                            self.pump.request_full();
                            self.flush_replies();
                        }
                        Err(error) => log::warn!("terminal cell pixels failed: {error}"),
                    }
                }
            }
            if let Some(colors) = c.colors {
                match colors.apply(&mut self.term) {
                    Ok(()) => self.pump.request_full(),
                    Err(e) => log::warn!("terminal engine colors failed: {e}"),
                }
            }
            if let Some(enabled) = c.cursor_blink {
                match super::cursor::apply(&mut self.term, enabled) {
                    Ok(()) => self.pump.request_full(),
                    Err(error) => {
                        log::error!("terminal cursor preference update failed: {error}");
                        self.health.fail(EngineFailure::SnapshotFailed);
                    }
                }
            }
            if c.scroll != 0 {
                let delta = isize::try_from(c.scroll).unwrap_or(if c.scroll < 0 {
                    isize::MIN
                } else {
                    isize::MAX
                });
                self.term.scroll_viewport(ScrollViewport::Delta(delta));
                self.pump.output();
            }
            if c.full {
                self.pump.request_full();
            }
            for request in c.text_requests {
                let result = if self.health.failure().is_some() {
                    Err("terminal engine is unavailable".into())
                } else {
                    super::text::read_text(&self.term, request.lines)
                };
                let _ = request.reply.try_send(result);
                let mut control = self.control.lock().unwrap_or_else(PoisonError::into_inner);
                control.text_pending = control.text_pending.saturating_sub(1);
            }
            for request in c.search_requests {
                let result = if self.health.failure().is_some() {
                    Err("terminal engine is unavailable".into())
                } else {
                    let result = self.search.apply(&mut self.term, &request.command);
                    self.pump.request_full();
                    result
                };
                let _ = request.reply.try_send(result);
                let mut control = self.control.lock().unwrap_or_else(PoisonError::into_inner);
                control.text_pending = control.text_pending.saturating_sub(1);
            }
            for request in c.link_requests {
                let result = if self.health.failure().is_some() {
                    Err("terminal engine is unavailable".into())
                } else {
                    self.snapshot
                        .link_context(request.seq, request.col, request.row)
                };
                let _ = request.reply.try_send(result);
                let mut control = self.control.lock().unwrap_or_else(PoisonError::into_inner);
                control.text_pending = control.text_pending.saturating_sub(1);
            }
            for request in c.interaction_requests {
                match request {
                    InteractionRequest::Selection(request) => {
                        let result = if self.health.failure().is_some() {
                            Err("terminal engine is unavailable".into())
                        } else {
                            if !matches!(
                                request.command,
                                super::selection::SelectionCommand::Read
                                    | super::selection::SelectionCommand::Release
                            ) {
                                if let Some(actions) = &mut self.block_actions {
                                    actions.manual_selection();
                                }
                            }
                            let update = self.selection.update(&self.term, &request.command);
                            if update.redraw {
                                self.pump.request_full();
                            }
                            update.text
                        };
                        let _ = request.reply.try_send(result);
                    }
                    InteractionRequest::Block(request) => {
                        match request {
                            BlockRequest::Action { command, reply } => {
                                let result = if self.health.failure().is_some() {
                                    Err("terminal engine is unavailable".into())
                                } else {
                                    let result = match (
                                        &self.blocks,
                                        &self.block_frames,
                                        &mut self.block_actions,
                                    ) {
                                        (Some(blocks), Some(frames), Some(actions)) => actions
                                            .apply(
                                                &mut self.term,
                                                blocks,
                                                frames,
                                                &mut self.selection,
                                                &command,
                                            ),
                                        _ => Err("native blocks are not enabled".into()),
                                    };
                                    // An action may mutate selection before formatting its receipt fails.
                                    self.pump.request_full();
                                    result
                                };
                                let _ = reply.try_send(result);
                            }
                            BlockRequest::Snapshot { seq, reply } => {
                                let result = if self.health.failure().is_some() {
                                    Err("terminal engine is unavailable".into())
                                } else {
                                    self.blocks
                                        .as_ref()
                                        .ok_or_else(|| "native blocks are not enabled".into())
                                        .and_then(|blocks| match seq {
                                            None => blocks.snapshot(&self.term),
                                            Some(seq) => self
                                                .block_frames
                                                .as_ref()
                                                .and_then(|frames| frames.query(seq))
                                                .ok_or_else(|| {
                                                    "terminal block frame is no longer available"
                                                        .into()
                                                }),
                                        })
                                };
                                let _ = reply.try_send(result);
                            }
                            BlockRequest::Read { id, reply } => {
                                let result = if self.health.failure().is_some() {
                                    Err("terminal engine is unavailable".into())
                                } else {
                                    self.blocks
                                        .as_ref()
                                        .ok_or_else(|| "native blocks are not enabled".into())
                                        .and_then(|blocks| blocks.read(&self.term, &id))
                                };
                                let _ = reply.try_send(result);
                            }
                        }
                    }
                }
                let mut control = self.control.lock().unwrap_or_else(PoisonError::into_inner);
                control.text_pending = control.text_pending.saturating_sub(1);
            }
            if let Some(seq) = c.ack {
                if self.pump.credit(seq, Instant::now()) {
                    self.stats
                        .credits
                        .store(self.pump.credits(), Ordering::Relaxed);
                    let micros = self.pump.credit_wait().as_micros() as u64;
                    self.stats
                        .credit_wait_micros
                        .store(micros, Ordering::Relaxed);
                }
            }
        }

        fn emit(&mut self) {
            let blocks_pruned = match self
                .blocks
                .as_mut()
                .map(|blocks| blocks.prune_visible(&self.term))
                .transpose()
            {
                Ok(changed) => changed.unwrap_or(false),
                Err(error) => {
                    log::warn!("terminal block validation failed: {error}");
                    self.sink_open = false;
                    self.health.fail(EngineFailure::SnapshotFailed);
                    self.pump.nothing_changed();
                    return;
                }
            };
            let started = Instant::now();
            let seq = self.pump.next_seq();
            let search_was_active = self.search.is_active();
            let block_search_was_active = self
                .block_actions
                .as_ref()
                .is_some_and(|actions| actions.is_search_active());
            let mut highlights = self.search.highlights(&self.term).unwrap_or_else(|error| {
                log::warn!("terminal search highlight failed: {error}");
                self.search.clear();
                Vec::new()
            });
            let block_highlights = match (&mut self.block_actions, &self.blocks) {
                (Some(actions), Some(blocks)) => actions
                    .highlights(&self.term, blocks)
                    .unwrap_or_else(|error| {
                        log::warn!("terminal block search highlight failed: {error}");
                        Vec::new()
                    }),
                _ => Vec::new(),
            };
            if highlights.is_empty() {
                highlights = block_highlights;
            } else {
                for (target, source) in highlights.iter_mut().zip(block_highlights) {
                    *target = (*target).max(source);
                }
            }
            let blocks_changed = self
                .blocks
                .as_ref()
                .zip(self.block_frames.as_ref())
                .is_some_and(|(blocks, frames)| {
                    frames.metadata_version() != Some(blocks.metadata_version())
                });
            let full = self.pump.full_pending()
                || search_was_active
                || block_search_was_active
                || blocks_changed
                || blocks_pruned;
            let frame = if highlights.is_empty() {
                self.snapshot.build(&self.term, seq, full)
            } else {
                self.snapshot
                    .build_highlighted(&self.term, seq, full, &highlights)
            };
            let built = match frame {
                Ok(Some(frame)) => frame.to_vec(),
                Ok(None) => {
                    self.pump.nothing_changed();
                    return;
                }
                Err(e) => {
                    log::warn!("terminal engine snapshot failed: {e}");
                    self.sink_open = false;
                    self.health.fail(EngineFailure::SnapshotFailed);
                    self.pump.nothing_changed();
                    return;
                }
            };
            let block_projection = match self
                .blocks
                .as_ref()
                .map(|blocks| blocks.snapshot(&self.term))
                .transpose()
            {
                Ok(snapshot) => snapshot,
                Err(error) => {
                    log::warn!("terminal block projection failed: {error}");
                    self.health.fail(EngineFailure::SnapshotFailed);
                    self.pump.nothing_changed();
                    return;
                }
            };
            let encode = started.elapsed();
            let len = built.len() as u64;
            let sending = Instant::now();
            let sent = (self.frames)(built);
            self.stats
                .send_micros
                .fetch_add(sending.elapsed().as_micros() as u64, Ordering::Relaxed);
            if !sent {
                log::debug!("terminal engine frame channel closed; no more frames");
                self.sink_open = false;
                self.health.fail(EngineFailure::FrameChannelClosed);
                return;
            }
            if let (Some(frames), Some(snapshot)) = (&mut self.block_frames, block_projection) {
                frames.commit(seq, snapshot);
            }
            self.pump.sent(Instant::now());
            self.stats.frames.fetch_add(1, Ordering::Relaxed);
            self.stats.frame_bytes.fetch_add(len, Ordering::Relaxed);
            self.stats
                .encode_micros
                .fetch_add(encode.as_micros() as u64, Ordering::Relaxed);
        }

        /// Applies pending commands and sends a frame when one is due.
        /// Returns how long the engine may block before it must look again.
        fn tick(&mut self) -> Option<std::time::Duration> {
            self.apply_control();
            if self.stop_requested || !self.sink_open {
                return None;
            }
            match self.pump.decide(Instant::now()) {
                Decision::Idle => None,
                Decision::Wait(d) => Some(d),
                Decision::Now => {
                    self.emit();
                    None
                }
            }
        }

        // The final input snapshot may supersede the in-flight frame. Later
        // presentation updates still wait for the next returned credit.
        fn finish(&mut self) {
            self.apply_control();
            if !self.stop_requested && self.sink_open && self.pump.has_pending() {
                self.emit();
            }
        }

        fn finish_input(&mut self) -> Result<(), EngineFailure> {
            if !self.input_finished {
                if let Some(blocks) = &mut self.blocks {
                    let previous = blocks.metadata_version();
                    if let Err(error) = blocks.finish_input(&self.term, block_time()) {
                        log::warn!("terminal block finalization failed: {error}");
                        self.health.fail(EngineFailure::SnapshotFailed);
                    }
                    if blocks.metadata_version() != previous {
                        self.pump.request_full();
                    }
                }
                self.update_input_state();
                self.finish();
                self.input_finished = true;
                self.reply_sink.take();
                *self.replies.borrow_mut() = Vec::new();
            }
            if self.stop_requested {
                return Err(EngineFailure::Cancelled);
            }
            self.health.failure().map_or(Ok(()), Err)
        }
    }

    impl Drop for Session<'_> {
        fn drop(&mut self) {
            self.selection.reset(&self.term);
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn run(
        cols: u16,
        rows: u16,
        appearance: Appearance,
        shell_token: Option<String>,
        blocks_enabled: bool,
        rx: &Receiver<Input>,
        control: Arc<Mutex<Control>>,
        stats: Arc<Stats>,
        frames: FrameSink,
        reply_sink: ReplySink,
        ready: SyncSender<Result<(), String>>,
        health: Arc<EngineHealth>,
    ) {
        let replies = RefCell::new(Vec::new());
        let setup = || -> Result<(Terminal<'static, '_>, Snapshotter), libghostty_vt::Error> {
            let mut term = Terminal::new(TerminalOptions {
                cols,
                rows,
                max_scrollback: SCROLLBACK_BYTES,
            })?;
            term.resize(cols, rows, 8, 16)?;
            super::cursor::apply(&mut term, appearance.cursor_blink)?;
            super::graphics::configure(&mut term)?;
            if let Some(colors) = &appearance.colors {
                colors.apply(&mut term)?;
            }
            term.on_pty_write(|_, data| replies.borrow_mut().extend_from_slice(data))?
                .on_device_attributes(|_| Some(DEVICE_ATTRIBUTES))?;
            Ok((term, Snapshotter::new()?))
        };
        let (term, snapshot) = match setup() {
            Ok(parts) => parts,
            Err(e) => {
                let _ = ready.send(Err(format!("terminal engine init failed: {e}")));
                return;
            }
        };
        let mut shell = super::shell::ShellIntegration::new(shell_token);
        let clipboard = stats.clone();
        shell.on_clipboard(move |data| clipboard.clipboard.record(data));
        let mut session = Session {
            term,
            snapshot,
            pump: Pump::new(),
            size: (cols, rows),
            cell_pixels: (8, 16),
            frames,
            sink_open: true,
            health,
            replies: &replies,
            reply_sink: Some(reply_sink),
            input_finished: false,
            stop_requested: false,
            selection: super::selection::SelectionState::default(),
            search: super::search::SearchState::default(),
            keyboard_modes: super::keyboard_modes::KeyboardModes::default(),
            shell,
            blocks: blocks_enabled.then(super::blocks::BlockStore::default),
            block_frames: blocks_enabled.then(super::blocks::BlockFrames::default),
            block_actions: blocks_enabled.then(super::block_actions::BlockActions::default),
            control,
            stats,
        };
        session.update_scrollback_rows();
        session.update_input_state();
        let _ = ready.send(Ok(()));
        loop {
            let waiting = session.tick();
            if session.stop_requested {
                return;
            }
            let message = match waiting {
                None => match rx.recv() {
                    Ok(m) => m,
                    Err(_) => return,
                },
                Some(wait) => match rx.recv_timeout(wait) {
                    Ok(m) => m,
                    Err(RecvTimeoutError::Timeout) => continue,
                    Err(RecvTimeoutError::Disconnected) => return,
                },
            };
            match message {
                Input::Bytes(bytes) => session.feed(&bytes),
                Input::Wake => {}
                Input::Encode(event, reply) => {
                    let result = if session.input_finished || session.health.failure().is_some() {
                        Err("terminal engine input is unavailable".into())
                    } else {
                        super::input::encode(
                            &session.term,
                            &event,
                            session.keyboard_modes.modify_other_keys(),
                        )
                    };
                    let _ = reply.try_send(result);
                }
                Input::Finish(reply) => {
                    let result = session.finish_input();
                    let _ = reply.try_send(result);
                }
                Input::Shutdown => {
                    let _ = session.finish_input();
                    return;
                }
            }
        }
    }
    #[cfg(test)]
    mod pixel_control_tests {
        use super::Control;
        #[test]
        fn pending_grid_and_pixel_updates_preserve_admission_order() {
            let mut state = Control::default();
            state.queue_cell_pixels(10, 20);
            state.queue_resize(80, 24, 12, 24);
            assert_eq!(state.resize, Some((80, 24, 12, 24)));
            assert_eq!(state.cell_pixels, None);
            state.queue_cell_pixels(16, 32);
            assert_eq!(state.resize, Some((80, 24, 16, 32)));
            assert_eq!(state.cell_pixels, None);
        }
    }
}

#[cfg(test)]
mod pump_tests {
    use super::*;

    #[test]
    fn credit_stats_accumulate_only_accepted_acknowledgements() {
        let now = Instant::now();
        let mut pump = Pump::new();
        pump.sent(now);
        pump.output();
        pump.decide(now);
        assert!(pump.credit(1, now + Duration::from_millis(3)));
        assert!(!pump.credit(1, now + Duration::from_millis(9)));
        pump.sent(now + Duration::from_millis(10));
        pump.output();
        pump.decide(now + Duration::from_millis(12));
        assert!(!pump.credit(1, now + Duration::from_millis(14)));
        assert!(pump.credit(2, now + Duration::from_millis(17)));
        assert_eq!(pump.credit_wait(), Duration::from_millis(8));
        assert_eq!(pump.credits(), 2);
        pump.sent(now + Duration::from_millis(20));
        assert!(pump.credit(3, now + Duration::from_millis(21)));
        assert_eq!(pump.credit_wait(), Duration::from_millis(8));
        assert_eq!(pump.credits(), 3);
    }

    #[test]
    fn a_new_session_owes_a_full_frame_and_holds_a_credit() {
        let mut pump = Pump::new();
        assert!(pump.full_pending());
        assert_eq!(pump.decide(Instant::now()), Decision::Now);
        assert_eq!(pump.next_seq(), 1);
    }

    #[test]
    fn no_frame_without_a_credit() {
        let t0 = Instant::now();
        let mut pump = Pump::new();
        pump.sent(t0);
        pump.output();
        assert_eq!(pump.decide(t0 + Duration::from_secs(1)), Decision::Idle);
    }

    #[test]
    fn only_the_frame_in_flight_returns_a_credit() {
        let t0 = Instant::now();
        let mut pump = Pump::new();
        assert!(!pump.credit(0, t0), "the initial credit is already held");
        pump.sent(t0);
        assert_eq!(pump.next_seq(), 2);
        assert!(!pump.credit(7, t0), "unknown seq");
        assert!(pump.credit(1, t0));
        assert!(!pump.credit(1, t0), "duplicate");
    }

    #[test]
    fn nothing_pending_means_idle_even_with_a_credit() {
        let t0 = Instant::now();
        let mut pump = Pump::new();
        pump.sent(t0);
        assert!(pump.credit(1, t0));
        assert_eq!(pump.decide(t0 + Duration::from_secs(1)), Decision::Idle);
        pump.output();
        assert_eq!(pump.decide(t0 + Duration::from_secs(1)), Decision::Now);
    }

    #[test]
    fn frames_are_at_least_the_minimum_interval_apart() {
        let t0 = Instant::now();
        let mut pump = Pump::new();
        pump.sent(t0);
        assert!(pump.credit(1, t0));
        pump.output();
        assert_eq!(
            pump.decide(t0 + Duration::from_millis(1)),
            Decision::Wait(MIN_FRAME_INTERVAL - Duration::from_millis(1))
        );
        assert_eq!(pump.decide(t0 + MIN_FRAME_INTERVAL), Decision::Now);
    }

    #[test]
    fn an_unchanged_snapshot_keeps_the_credit() {
        let t0 = Instant::now();
        let mut pump = Pump::new();
        pump.sent(t0);
        assert!(pump.credit(1, t0));
        pump.output();
        pump.nothing_changed();
        assert_eq!(pump.decide(t0 + Duration::from_secs(1)), Decision::Idle);
        pump.output();
        assert_eq!(pump.decide(t0 + Duration::from_secs(1)), Decision::Now);
    }

    #[test]
    fn credit_wait_counts_only_time_with_output_pending() {
        let t0 = Instant::now();
        let mut pump = Pump::new();
        pump.sent(t0);
        // Idle while nothing is pending: not waiting on the webview.
        assert_eq!(pump.decide(t0 + Duration::from_millis(100)), Decision::Idle);
        pump.output();
        assert_eq!(pump.decide(t0 + Duration::from_millis(200)), Decision::Idle);
        assert!(pump.credit(1, t0 + Duration::from_millis(230)));
        assert_eq!(pump.credit_wait(), Duration::from_millis(30));
    }

    #[test]
    fn a_requested_full_frame_is_cleared_by_sending() {
        let t0 = Instant::now();
        let mut pump = Pump::new();
        pump.sent(t0);
        pump.request_full();
        assert!(pump.full_pending());
        assert!(pump.credit(1, t0));
        pump.sent(t0 + MIN_FRAME_INTERVAL);
        assert!(!pump.full_pending());
        assert!(!pump.has_pending());
    }

    #[test]
    fn sizes_are_bounded() {
        assert!(validate_size(80, 24).is_ok());
        assert!(validate_size(1, 1).is_ok());
        assert!(validate_size(MAX_COLS, MAX_ROWS).is_ok());
        assert!(validate_size(0, 24).is_err());
        assert!(validate_size(80, 0).is_err());
        assert!(validate_size(MAX_COLS + 1, 24).is_err());
        assert!(validate_size(80, MAX_ROWS + 1).is_err());
    }
}

#[cfg(all(test, feature = "ghostty-engine"))]
mod fixtures;

#[cfg(all(test, feature = "ghostty-engine"))]
mod engine_tests {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
    use std::sync::{Arc, Condvar, Mutex};
    use std::thread;
    use std::time::Duration;

    use super::frame::decode::{decode, Frame};
    use super::frame::FLAG_VIEWPORT_SCROLLED;
    use super::*;

    const WAIT: Duration = Duration::from_secs(5);
    const QUIET: Duration = Duration::from_millis(150);

    struct Harness {
        handle: EngineHandle,
        input: EngineInput,
        thread: EngineThread,
        frames: Receiver<Vec<u8>>,
        replies: Receiver<Vec<u8>>,
    }

    fn harness(cols: u16, rows: u16) -> Harness {
        harness_with_gate(cols, rows, None)
    }

    type Gate = Arc<(Mutex<bool>, Condvar)>;

    // With a gate, every frame send blocks until the gate opens: a consumer
    // that has stopped reading.
    fn harness_with_gate(cols: u16, rows: u16, gate: Option<Gate>) -> Harness {
        let (ftx, frames) = mpsc::channel();
        let (rtx, replies) = mpsc::channel();
        let Engine {
            handle,
            input,
            thread,
        } = start(
            cols,
            rows,
            Box::new(move |frame| {
                if let Some(gate) = &gate {
                    let (open, cv) = &**gate;
                    let mut open = open.lock().unwrap();
                    while !*open {
                        open = cv.wait(open).unwrap();
                    }
                }
                ftx.send(frame).is_ok()
            }),
            Box::new(move |reply| {
                let _ = rtx.send(reply.to_vec());
            }),
        )
        .expect("engine starts");
        Harness {
            handle,
            input,
            thread,
            frames,
            replies,
        }
    }

    impl Harness {
        fn frame(&self) -> Frame {
            decode(&self.frames.recv_timeout(WAIT).expect("a frame"))
        }

        fn assert_no_frame(&self) {
            match self.frames.recv_timeout(QUIET) {
                Err(RecvTimeoutError::Timeout) => {}
                Ok(bytes) => panic!("unexpected frame seq {}", decode(&bytes).seq),
                Err(e) => panic!("frame channel: {e}"),
            }
        }

        fn feed(&self, bytes: &[u8]) {
            assert!(self.input.feed(bytes.to_vec()));
        }

        fn replies_until(&self, expected: &[u8]) -> Vec<u8> {
            let mut got = Vec::new();
            while got.len() < expected.len() {
                got.extend(self.replies.recv_timeout(WAIT).expect("a reply"));
            }
            got
        }

        fn shutdown(self) -> Receiver<Vec<u8>> {
            self.input.shutdown();
            self.thread.join().expect("healthy engine shutdown");
            self.frames
        }
    }

    #[test]
    fn frame_sink_duration_is_measured_separately_from_encoding() {
        let engine = start(
            4,
            2,
            Box::new(|_| {
                std::thread::sleep(std::time::Duration::from_millis(3));
                true
            }),
            Box::new(|_| {}),
        )
        .unwrap();
        engine.input.shutdown();
        engine.thread.join().expect("healthy engine shutdown");
        let stats = engine.handle.stats();
        assert!(stats.frames > 0);
        assert!(stats.send_micros >= stats.frames * 3000);
    }

    #[test]
    fn a_session_starts_with_a_full_frame() {
        let h = harness(20, 5);
        let f = h.frame();
        assert_eq!(f.seq, 1);
        assert!(f.full());
        assert_eq!((f.cols, f.rows), (20, 5));
        assert_eq!(f.row_records.len(), 5);
        assert_eq!(h.handle.stats().scrollback_rows, Some(0));
        h.assert_no_frame();
    }

    #[test]
    fn bytes_in_produce_a_frame() {
        let h = harness(20, 5);
        h.frame();
        h.feed(b"hello");
        h.handle.credit(1);
        let f = h.frame();
        assert_eq!(f.seq, 2);
        assert!(!f.full());
        assert_eq!(f.row(0).unwrap().text(), "hello");
        assert_eq!((f.cursor_x, f.cursor_y), (5, 0));
    }

    #[test]
    fn no_frame_without_a_credit() {
        let h = harness(20, 5);
        h.frame();
        for _ in 0..10 {
            h.feed(b"more output\r\n");
        }
        h.assert_no_frame();
        assert_eq!(h.handle.stats().frames, 1);
    }

    #[test]
    fn a_credit_after_dirty_output_produces_exactly_one_frame() {
        let h = harness(20, 5);
        h.frame();
        h.feed(b"a");
        h.feed(b"b");
        h.feed(b"c");
        thread::sleep(Duration::from_millis(20));
        h.handle.credit(1);
        let f = h.frame();
        assert_eq!(f.seq, 2);
        assert_eq!(f.row(0).unwrap().text(), "abc");
        h.assert_no_frame();
        // A credit with nothing new to show sends nothing either.
        h.handle.credit(2);
        h.assert_no_frame();
        h.feed(b"d");
        let f = h.frame();
        assert_eq!(f.seq, 3);
        assert_eq!(f.row(0).unwrap().text(), "abcd");
    }

    #[test]
    fn stale_or_duplicate_credits_are_ignored() {
        let h = harness(20, 5);
        h.frame();
        h.feed(b"x");
        h.handle.credit(9);
        h.handle.credit(0);
        h.assert_no_frame();
        h.handle.credit(1);
        assert_eq!(h.frame().seq, 2);
        h.feed(b"y");
        h.handle.credit(1);
        h.assert_no_frame();
    }

    #[test]
    fn resize_yields_a_full_frame_with_the_new_size() {
        let h = harness(20, 5);
        h.frame();
        h.feed(b"keep me");
        h.handle.credit(1);
        h.frame();
        h.handle.resize(30, 8);
        h.handle.credit(2);
        let f = h.frame();
        assert!(f.full());
        assert_eq!((f.cols, f.rows), (30, 8));
        assert_eq!(f.row_records.len(), 8);
        assert_eq!(f.row(0).unwrap().text(), "keep me");
    }

    #[test]
    fn live_colors_wait_for_credit_then_send_a_full_frame() {
        let h = harness(20, 5);
        h.frame();
        h.handle.set_colors(super::super::colors::Colors {
            foreground: [1, 2, 3],
            background: [4, 5, 6],
            cursor: Some([7, 8, 9]),
            palette: [[10, 11, 12]; 16],
        });
        h.assert_no_frame();
        h.handle.credit(1);
        let frame = h.frame();
        assert!(frame.full());
        assert_eq!(frame.default_fg, super::frame::rgb(1, 2, 3));
        assert_eq!(frame.default_bg, super::frame::rgb(4, 5, 6));
        assert_eq!(frame.cursor_color, super::frame::rgb(7, 8, 9));
        assert_eq!(frame.row_records.len(), 5);
        assert_eq!(h.handle.stats().credits, 1);
    }

    #[test]
    fn initial_colors_are_applied_before_the_first_frame() {
        let (tx, rx) = mpsc::channel();
        let engine = start_with_colors(
            20,
            5,
            Some(super::super::colors::Colors {
                foreground: [1, 2, 3],
                background: [4, 5, 6],
                cursor: None,
                palette: [[10, 11, 12]; 16],
            }),
            Box::new(move |frame| tx.send(frame).is_ok()),
            Box::new(|_| {}),
        )
        .unwrap();
        let frame = decode(&rx.recv_timeout(WAIT).unwrap());
        assert_eq!(frame.default_fg, super::frame::rgb(1, 2, 3));
        assert_eq!(frame.default_bg, super::frame::rgb(4, 5, 6));
        assert_eq!(engine.handle.stats().credits, 0);
        engine.input.shutdown();
        engine.thread.join().expect("healthy engine shutdown");
    }

    #[test]
    fn an_invalid_resize_is_ignored() {
        let h = harness(20, 5);
        h.frame();
        h.handle.credit(1);
        h.handle.resize(0, 5);
        h.assert_no_frame();
        h.feed(b"z");
        let f = h.frame();
        assert_eq!((f.cols, f.rows), (20, 5));
    }

    #[test]
    fn request_full_resends_every_row() {
        let h = harness(20, 5);
        h.frame();
        h.handle.credit(1);
        h.handle.request_full();
        let f = h.frame();
        assert!(f.full());
        assert_eq!(f.row_records.len(), 5);
    }

    #[test]
    fn scrolling_into_history_flags_the_viewport() {
        let h = harness(10, 3);
        h.frame();
        for i in 0..8 {
            h.feed(format!("line {i}\r\n").as_bytes());
        }
        h.handle.credit(1);
        let f = h.frame();
        assert_eq!(f.flags & FLAG_VIEWPORT_SCROLLED, 0);
        assert_eq!(f.row(1).unwrap().text(), "line 7");

        h.handle.scroll(-3);
        h.handle.credit(2);
        let f = h.frame();
        assert_ne!(f.flags & FLAG_VIEWPORT_SCROLLED, 0);
        assert_eq!(f.row(0).unwrap().text(), "line 3");

        h.handle.scroll(3);
        h.handle.credit(3);
        let f = h.frame();
        assert_eq!(f.flags & FLAG_VIEWPORT_SCROLLED, 0);
    }

    fn feed_history(h: &Harness, lines: usize) {
        let mut bytes = Vec::with_capacity(16 * 1024);
        for i in 0..lines {
            bytes.extend_from_slice(format!("idle scrollback line {i:05}\r\n").as_bytes());
            if bytes.len() >= 16 * 1024 - 64 {
                h.feed(&bytes);
                bytes.clear();
            }
        }
        if !bytes.is_empty() {
            h.feed(&bytes);
        }
    }

    #[test]
    fn idle_lab_retains_exactly_ten_thousand_measured_history_rows() {
        let h = harness(100, 30);
        h.frame();
        feed_history(&h, 70);
        h.feed(b"\x1b[3J\x1b[2J\x1b[H");
        feed_history(&h, 10_000 + 30 - 1);
        h.feed(b"\x1b[2J\x1b[HTERAX_IDLE_READY");
        let handle = h.handle.clone();
        let frames = h.shutdown();
        let frame = decode(&frames.recv_timeout(WAIT).expect("idle final frame"));
        assert_eq!(frame.row(0).unwrap().text(), "TERAX_IDLE_READY");
        assert_eq!(handle.stats().scrollback_rows, Some(10_000));
        assert_eq!(SCROLLBACK_BYTES, 16 * 1024 * 1024);
        assert_eq!(
            serde_json::to_value(handle.stats()).unwrap()["scrollbackRows"],
            10_000
        );
    }

    #[test]
    fn scrollback_budget_prunes_old_rows_instead_of_growing_without_bound() {
        let h = harness(100, 30);
        h.frame();
        feed_history(&h, 50_000 + 30 - 1);
        let handle = h.handle.clone();
        h.shutdown();
        let retained = handle.stats().scrollback_rows.expect("history rows");
        assert!(
            retained >= 10_000,
            "budget is large enough for the lab: {retained}"
        );
        assert!(retained < 30_000, "byte budget prunes old rows: {retained}");
    }

    #[test]
    fn scrollback_rows_are_a_gauge_that_changes_after_resize_and_clear() {
        let h = harness(100, 30);
        h.frame();
        feed_history(&h, 100);
        h.feed(b"\x1b[6n");
        h.replies_until(b"\x1b[30;1R");
        assert_eq!(h.handle.stats().scrollback_rows, Some(71));

        h.handle.resize(100, 20);
        h.handle.request_full();
        h.handle.credit(1);
        let frame = h.frame();
        assert_eq!(frame.rows, 20);
        assert_eq!(h.handle.stats().scrollback_rows, Some(81));

        h.feed(b"\x1b[3J");
        let handle = h.handle.clone();
        h.shutdown();
        assert_eq!(handle.stats().scrollback_rows, Some(0));
    }

    #[test]
    fn device_queries_are_answered_through_the_writer() {
        let h = harness(20, 5);
        h.feed(b"\x1b[c");
        assert_eq!(h.replies_until(b"\x1b[?1;2c"), b"\x1b[?1;2c");
        h.feed(b"\x1b[>c");
        assert_eq!(h.replies_until(b"\x1b[>0;276;0c"), b"\x1b[>0;276;0c");
        h.feed(b"\x1b[3;5H\x1b[6n");
        assert_eq!(h.replies_until(b"\x1b[3;5R"), b"\x1b[3;5R");
    }

    #[test]
    fn shutdown_delivers_the_final_frame_before_the_thread_exits() {
        let h = harness(20, 5);
        h.frame();
        h.feed(b"goodbye");
        let frames = h.shutdown();
        let f = decode(&frames.recv_timeout(WAIT).expect("final frame"));
        assert_eq!(f.row(0).unwrap().text(), "goodbye");
        assert!(matches!(
            frames.recv_timeout(QUIET),
            Err(RecvTimeoutError::Disconnected)
        ));
    }

    #[test]
    fn a_closed_frame_channel_does_not_stop_parsing() {
        let (handle, input, thread) = {
            let Engine {
                handle,
                input,
                thread,
            } = start(20, 5, Box::new(|_| false), Box::new(|_| {})).unwrap();
            (handle, input, thread)
        };
        for _ in 0..100 {
            assert!(input.feed(b"still parsing\r\n".to_vec()));
        }
        input.shutdown();
        assert_eq!(thread.join(), Err(EngineFailure::FrameChannelClosed));
        assert_eq!(handle.stats().bytes_fed, 1500);
        assert_eq!(handle.stats().frames, 0);
    }

    #[test]
    fn a_slow_consumer_blocks_the_producer_instead_of_dropping() {
        let gate: Gate = Arc::new((Mutex::new(false), Condvar::new()));
        let h = harness_with_gate(200, 5, Some(gate.clone()));
        // The engine is now stuck handing over its first frame.
        const LINES: usize = 64;
        let sent = Arc::new(AtomicUsize::new(0));
        let producer = {
            let input = h.input.clone();
            let sent = sent.clone();
            thread::spawn(move || {
                let mut total = 0usize;
                for i in 0..LINES {
                    let mut line = format!("line {i:04} ").into_bytes();
                    line.resize(198, b'.');
                    line.extend_from_slice(b"\r\n");
                    total += line.len();
                    assert!(input.feed(line));
                    sent.fetch_add(1, Ordering::SeqCst);
                }
                total
            })
        };
        thread::sleep(Duration::from_millis(300));
        assert_eq!(
            sent.load(Ordering::SeqCst),
            QUEUE_DEPTH,
            "the producer must block once the queue is full"
        );
        assert!(!producer.is_finished());

        {
            let (open, cv) = &*gate;
            *open.lock().unwrap() = true;
            cv.notify_all();
        }
        let total = producer.join().unwrap();
        assert_eq!(sent.load(Ordering::SeqCst), LINES);
        h.frame();
        h.handle.request_full();
        let stats = h.handle.clone();
        let frames = h.shutdown();
        assert_eq!(
            stats.stats().bytes_fed,
            total as u64,
            "every byte reached the terminal"
        );
        let last = decode(&frames.recv_timeout(WAIT).expect("final frame"));
        assert!(last.full());
        let shown: Vec<String> = last.row_records.iter().map(|r| r.text()).collect();
        assert!(
            shown.iter().any(|t| t.starts_with("line 0063 ")),
            "last line is on screen: {shown:?}"
        );
    }
    #[test]
    fn native_text_queries_read_history_without_a_frame_credit() {
        let h = harness(16, 2);
        h.frame();
        let bytes = b"one\r\ntwo\r\nthree\r\nfour";
        h.feed(bytes);
        let deadline = Instant::now() + WAIT;
        while h.handle.stats().bytes_fed < bytes.len() as u64 && Instant::now() < deadline {
            thread::yield_now();
        }
        assert_eq!(h.handle.stats().bytes_fed, bytes.len() as u64);
        let text = h
            .handle
            .read_text(2)
            .unwrap()
            .recv_timeout(WAIT)
            .unwrap()
            .unwrap();
        assert_eq!(text, "three\nfour");
        let handle = h.handle.clone();
        h.shutdown();
        assert!(handle.read_text(2).is_err());
    }

    #[test]
    fn text_queries_are_bounded_outside_the_full_byte_wake_queue() {
        let gate: Gate = Arc::new((Mutex::new(false), Condvar::new()));
        let waiting = gate.clone();
        let (entered, began) = mpsc::channel();
        let engine = start(
            8,
            2,
            Box::new(move |_| {
                let _ = entered.send(());
                let (open, wake) = &*waiting;
                let mut open = open.lock().unwrap();
                while !*open {
                    open = wake.wait(open).unwrap();
                }
                true
            }),
            Box::new(|_| {}),
        )
        .unwrap();
        began.recv_timeout(WAIT).unwrap();
        assert!(engine.handle.read_text(0).is_err());
        assert!(engine.handle.read_text(1001).is_err());
        let queries: Vec<_> = (0..26)
            .map(|_| engine.handle.read_text(2).unwrap())
            .collect();
        let search = engine
            .handle
            .search(super::search::SearchCommand::Clear)
            .unwrap();
        let selection = engine
            .handle
            .selection(super::selection::SelectionCommand::Read)
            .unwrap();
        let link = engine.handle.link_context(1, 0, 0).unwrap();
        assert!(engine.handle.read_block("b0".into()).is_err());
        let blocks = engine.handle.blocks().unwrap();
        let block_read = engine.handle.read_block("b1".into()).unwrap();
        assert!(engine
            .handle
            .block_action(super::block_actions::BlockCommand::Navigate { direction: 0 })
            .is_err());
        let block_action = engine
            .handle
            .block_action(super::block_actions::BlockCommand::ClearSearch)
            .unwrap();
        assert!(engine
            .handle
            .block_action(super::block_actions::BlockCommand::ClearSearch)
            .is_err());
        assert!(engine.handle.blocks().is_err());
        assert!(engine.handle.read_block("b1".into()).is_err());
        assert!(engine.handle.link_context(1, 0, 0).is_err());
        assert!(engine
            .handle
            .search(super::search::SearchCommand::Clear)
            .is_err());
        assert!(engine
            .handle
            .selection(super::selection::SelectionCommand::Read)
            .is_err());
        assert!(engine.handle.read_text(2).is_err());
        let (open, wake) = &*gate;
        *open.lock().unwrap() = true;
        wake.notify_all();
        for query in queries {
            assert_eq!(query.recv_timeout(WAIT).unwrap().unwrap(), "");
        }
        assert!(!search.recv_timeout(WAIT).unwrap().unwrap());
        assert_eq!(selection.recv_timeout(WAIT).unwrap().unwrap(), None);
        assert!(link.recv_timeout(WAIT).unwrap().unwrap().is_none());
        assert!(blocks
            .recv_timeout(WAIT)
            .unwrap()
            .unwrap_err()
            .contains("not enabled"));
        assert!(block_read
            .recv_timeout(WAIT)
            .unwrap()
            .unwrap_err()
            .contains("not enabled"));
        assert!(block_action
            .recv_timeout(WAIT)
            .unwrap()
            .unwrap_err()
            .contains("not enabled"));
        engine.input.shutdown();
        engine.thread.join().unwrap();
        assert!(engine.handle.read_text(2).is_err());
    }

    #[test]
    fn a_text_request_cannot_succeed_after_the_frame_pipeline_failed() {
        let gate: Gate = Arc::new((Mutex::new(false), Condvar::new()));
        let waiting = gate.clone();
        let (entered, began) = mpsc::channel();
        let engine = start(
            8,
            2,
            Box::new(move |_| {
                let _ = entered.send(());
                let (open, wake) = &*waiting;
                let mut open = open.lock().unwrap();
                while !*open {
                    open = wake.wait(open).unwrap();
                }
                false
            }),
            Box::new(|_| {}),
        )
        .unwrap();
        began.recv_timeout(WAIT).unwrap();
        let result = engine.handle.read_text(2).unwrap();
        let (open, wake) = &*gate;
        *open.lock().unwrap() = true;
        wake.notify_all();
        let reply = result.recv_timeout(WAIT).unwrap();
        engine.input.shutdown();
        assert_eq!(engine.thread.join(), Err(EngineFailure::FrameChannelClosed));
        assert!(
            reply.is_err(),
            "failed engines cannot provide valid app context"
        );
    }
    #[test]
    fn finishing_input_keeps_history_and_presentation_available_until_shutdown() {
        let h = harness(8, 2);
        h.frame();
        h.feed(b"one\r\ntwo\r\nthree\r\nfour");
        let finished = h.input.finish().unwrap();
        assert_eq!(finished.recv_timeout(WAIT).unwrap(), Ok(()));
        assert_eq!(
            h.handle
                .read_text(2)
                .unwrap()
                .recv_timeout(WAIT)
                .unwrap()
                .unwrap(),
            "three\nfour"
        );
        assert!(!h.input.feed(b"late output".to_vec()));
        assert!(h.input.finish().is_err());
        let final_frame = h.frame();
        h.handle.credit(final_frame.seq);
        h.handle.resize(12, 3);
        let resized = h.frame();
        assert_eq!((resized.cols, resized.rows), (12, 3));
        assert_eq!(
            h.handle
                .read_text(3)
                .unwrap()
                .recv_timeout(WAIT)
                .unwrap()
                .unwrap(),
            "two\nthree\nfour"
        );
        let handle = h.handle.clone();
        h.shutdown();
        assert!(handle.read_text(2).is_err());
    }

    #[test]
    fn retained_search_navigates_and_clears_native_highlights_after_input_finishes() {
        use super::frame::set_rgb;
        use super::search::SearchCommand;
        let h = harness(16, 2);
        h.frame();
        h.feed(b"needle needle\r\nlast");
        let finished = h.input.finish().unwrap();
        assert_eq!(finished.recv_timeout(WAIT).unwrap(), Ok(()));
        let final_frame = h.frame();
        let found = h
            .handle
            .search(SearchCommand::Find {
                query: "needle".into(),
                forward: true,
                incremental: true,
            })
            .unwrap();
        assert!(found.recv_timeout(WAIT).unwrap().unwrap());
        h.assert_no_frame();
        h.handle.credit(final_frame.seq);
        let highlighted = h.frame();
        let backgrounds: Vec<_> = highlighted
            .row(0)
            .unwrap()
            .runs
            .iter()
            .flat_map(|&(id, len)| {
                std::iter::repeat_n(highlighted.styles[usize::from(id)].bg, usize::from(len))
            })
            .collect();
        assert_eq!(&backgrounds[..6], &[set_rgb(0xd1, 0x86, 0x16); 6]);
        assert_eq!(&backgrounds[7..13], &[set_rgb(0x51, 0x5c, 0x6a); 6]);
        let cleared = h.handle.search(SearchCommand::Clear).unwrap();
        assert!(!cleared.recv_timeout(WAIT).unwrap().unwrap());
        h.handle.credit(highlighted.seq);
        let clean = h.frame();
        assert!(clean
            .styles
            .iter()
            .all(|s| s.bg != set_rgb(0xd1, 0x86, 0x16) && s.bg != set_rgb(0x51, 0x5c, 0x6a)));
        assert_eq!(clean.row(0).unwrap().text(), "needle needle");
        let handle = h.handle.clone();
        h.shutdown();
        assert!(handle.search(SearchCommand::Clear).is_err());
    }

    #[test]
    fn finish_releases_the_reply_writer_before_receipt_without_destroying_the_grid() {
        struct WriterGuard {
            dropped: mpsc::Sender<()>,
            replied: mpsc::Sender<Vec<u8>>,
        }
        impl WriterGuard {
            fn write(&self, bytes: &[u8]) {
                let _ = self.replied.send(bytes.to_vec());
            }
        }
        impl Drop for WriterGuard {
            fn drop(&mut self) {
                let _ = self.dropped.send(());
            }
        }
        let (dropped, drops) = mpsc::channel();
        let (replied, replies) = mpsc::channel();
        let writer = WriterGuard { dropped, replied };
        let engine = start(
            8,
            2,
            Box::new(|_| true),
            Box::new(move |bytes| writer.write(bytes)),
        )
        .unwrap();
        assert!(engine.input.feed(b"\x1b[c".to_vec()));
        assert!(!replies.recv_timeout(WAIT).unwrap().is_empty());
        assert!(drops.try_recv().is_err());
        assert_eq!(
            engine.input.finish().unwrap().recv_timeout(WAIT).unwrap(),
            Ok(())
        );
        drops
            .try_recv()
            .expect("reply writer was released before the finish receipt");
        assert_eq!(
            engine
                .handle
                .read_text(2)
                .unwrap()
                .recv_timeout(WAIT)
                .unwrap()
                .unwrap(),
            ""
        );
        engine.input.shutdown();
        engine.thread.join().unwrap();
        assert!(drops.try_recv().is_err());
    }

    #[test]
    fn a_failed_final_frame_rejects_finish_instead_of_retaining_a_healthy_grid() {
        let (sent, frames) = mpsc::channel();
        let count = Arc::new(AtomicUsize::new(0));
        let calls = count.clone();
        let engine = start(
            8,
            2,
            Box::new(move |frame| {
                if calls.fetch_add(1, Ordering::SeqCst) == 0 {
                    sent.send(frame).is_ok()
                } else {
                    false
                }
            }),
            Box::new(|_| {}),
        )
        .unwrap();
        frames.recv_timeout(WAIT).unwrap();
        assert!(engine.input.feed(b"final output".to_vec()));
        let result = engine.input.finish().unwrap().recv_timeout(WAIT).unwrap();
        assert_eq!(result, Err(EngineFailure::FrameChannelClosed));
        assert!(engine.handle.read_text(2).is_err());
        engine.input.shutdown();
        assert_eq!(engine.thread.join(), Err(EngineFailure::FrameChannelClosed));
    }

    #[test]
    fn finishing_after_a_full_byte_queue_preserves_every_accepted_byte() {
        let gate: Gate = Arc::new((Mutex::new(false), Condvar::new()));
        let h = harness_with_gate(16, 2, Some(gate.clone()));
        let mut total = 0;
        for n in 0..QUEUE_DEPTH {
            let line = format!("line{n}\r\n");
            total += line.len();
            h.feed(line.as_bytes());
        }
        let input = h.input.clone();
        let finishing = thread::spawn(move || input.finish().unwrap());
        let (open, wake) = &*gate;
        *open.lock().unwrap() = true;
        wake.notify_all();
        let result = finishing.join().unwrap();
        assert_eq!(result.recv_timeout(WAIT).unwrap(), Ok(()));
        assert_eq!(h.handle.stats().bytes_fed, total as u64);
        let text = h
            .handle
            .read_text(1000)
            .unwrap()
            .recv_timeout(WAIT)
            .unwrap()
            .unwrap();
        for n in 0..QUEUE_DEPTH {
            assert!(text.contains(&format!("line{n}")));
        }
        h.shutdown();
    }
}

#[cfg(all(test, feature = "ghostty-engine"))]
mod shell_actor_tests {
    use super::*;
    #[test]
    fn authenticated_shell_state_is_published_in_input_order() {
        let engine = start_with_shell(
            20,
            3,
            None,
            shell::ShellToken::for_test(),
            Box::new(|_| true),
            Box::new(|_| {}),
        )
        .unwrap();
        let token = "1234567890abcdef1234567890abcdef";
        let ready=format!("\x1b]133;D;0;aid={token}\x07\x1b]7;file://host/tmp/native\x07\x1b]133;B;aid={token}\x07");
        assert!(engine.input.feed(ready.into_bytes()));
        let finished = engine.input.finish().unwrap();
        finished.recv().unwrap().unwrap();
        let state = engine.handle.input_state();
        assert_eq!(state.shell.cwd.as_deref(), Some("/tmp/native"));
        assert!(state.shell.shell_ready);
        assert!(!state.shell.command_running);
        engine.input.shutdown();
        engine.thread.join().unwrap();
    }
}

#[cfg(all(test, feature = "ghostty-engine"))]
mod block_actor_tests {
    use super::*;
    const WAIT: Duration = Duration::from_secs(3);
    const TOKEN: &str = "1234567890abcdef1234567890abcdef";
    fn engine(blocks: bool) -> Engine {
        start_with_shell(
            30,
            5,
            None,
            ShellConfig {
                token: shell::ShellToken::for_test(),
                blocks,
            },
            Box::new(|_| true),
            Box::new(|_| {}),
        )
        .unwrap()
    }
    fn end_input(engine: &Engine) {
        engine
            .input
            .finish()
            .unwrap()
            .recv_timeout(WAIT)
            .unwrap()
            .unwrap();
    }
    #[test]
    fn one_message_preserves_each_block_boundary_and_post_exit_reads() {
        let engine = engine(true);
        let input=format!("\x1b]133;A;aid={TOKEN}\x07\x1b]7;file://host/tmp/native\x07cmd1\r\n\x1b]133;C;aid={TOKEN};cmdline_url=cmd1\x07one\r\n\x1b]133;D;0;aid={TOKEN}\x07cmd2\r\n\x1b]133;C;aid={TOKEN};cmdline_url=cmd2\x07two\r\n\x1b]133;D;2;aid={TOKEN}\x07PROMPT");
        let bytes = input.len();
        assert!(engine.input.feed(input.into_bytes()));
        end_input(&engine);
        let snapshot = engine
            .handle
            .blocks()
            .unwrap()
            .recv_timeout(WAIT)
            .unwrap()
            .unwrap();
        assert_eq!(snapshot.blocks.len(), 2);
        assert_eq!(snapshot.metadata_version, 4);
        assert_eq!(
            engine
                .handle
                .read_block("b1".into())
                .unwrap()
                .recv_timeout(WAIT)
                .unwrap()
                .unwrap()
                .unwrap()
                .output,
            "one"
        );
        let second = engine
            .handle
            .read_block("b2".into())
            .unwrap()
            .recv_timeout(WAIT)
            .unwrap()
            .unwrap()
            .unwrap();
        assert_eq!(
            (
                second.output.as_str(),
                second.cwd.as_str(),
                second.exit_code
            ),
            ("two", "/tmp/native", Some(2))
        );
        let state = engine.handle.input_state();
        assert!(state.blocks_enabled);
        assert_eq!(state.blocks_metadata_version, 4);
        assert_eq!(engine.handle.stats().bytes_fed, bytes as u64);
        engine.input.shutdown();
        engine.thread.join().unwrap();
        assert!(engine.handle.blocks().is_err());
        assert!(engine.handle.read_block("b1".into()).is_err());
    }
    #[test]
    fn block_tracking_is_opt_in_and_disabled_queries_fail_explicitly() {
        let engine = engine(false);
        assert!(engine.input.feed(
            format!("\x1b]133;C;aid={TOKEN}\x07out\x1b]133;D;0;aid={TOKEN}\x07").into_bytes()
        ));
        end_input(&engine);
        let error = engine
            .handle
            .blocks()
            .unwrap()
            .recv_timeout(WAIT)
            .unwrap()
            .unwrap_err();
        assert!(error.contains("not enabled"));
        assert!(!engine.handle.input_state().blocks_enabled);
        engine.input.shutdown();
        engine.thread.join().unwrap();
    }
    #[test]
    fn eof_finishes_a_live_block_once_without_inventing_an_exit_code() {
        let engine = engine(true);
        assert!(engine
            .input
            .feed(format!("\x1b]133;C;aid={TOKEN}\x07last\r\n").into_bytes()));
        end_input(&engine);
        assert!(engine.input.finish().is_err());
        let snapshot = engine
            .handle
            .blocks()
            .unwrap()
            .recv_timeout(WAIT)
            .unwrap()
            .unwrap();
        assert_eq!(snapshot.metadata_version, 2);
        let meta = &snapshot.blocks[0];
        assert!(!meta.running);
        assert_eq!(meta.exit_code, None);
        assert_eq!(
            engine
                .handle
                .read_block(meta.id.clone())
                .unwrap()
                .recv_timeout(WAIT)
                .unwrap()
                .unwrap()
                .unwrap()
                .output,
            "last"
        );
        engine.input.shutdown();
        engine.thread.join().unwrap();
    }
}

#[cfg(all(test, feature = "ghostty-engine"))]
mod block_presentation_actor_tests {
    use super::*;
    #[test]
    fn block_queries_are_bound_to_retained_frames_even_after_eof() {
        let (tx, rx) = std::sync::mpsc::channel();
        let engine = start_with_shell(
            30,
            5,
            None,
            ShellConfig {
                token: shell::ShellToken::for_test(),
                blocks: true,
            },
            Box::new(move |bytes| tx.send(bytes).is_ok()),
            Box::new(|_| {}),
        )
        .unwrap();
        let bytes=b"\x1b]133;C;aid=1234567890abcdef1234567890abcdef;cmdline_url=one\x07one\r\n\x1b]133;D;0;aid=1234567890abcdef1234567890abcdef\x07";
        assert!(engine.input.feed(bytes.to_vec()));
        engine
            .input
            .finish()
            .unwrap()
            .recv_timeout(Duration::from_secs(3))
            .unwrap()
            .unwrap();
        let mut latest = None;
        while let Ok(frame) = rx.try_recv() {
            latest = Some(super::frame::decode::decode(&frame).seq);
        }
        let seq = latest.unwrap();
        let snapshot = engine
            .handle
            .blocks_for_frame(seq)
            .unwrap()
            .recv_timeout(Duration::from_secs(3))
            .unwrap()
            .unwrap();
        assert_eq!(snapshot.seq, Some(seq));
        assert_eq!(snapshot.blocks.len(), 1);
        assert_eq!(snapshot.blocks[0].command, "one");
        assert!(engine.handle.blocks_for_frame(0).is_err());
        assert!(engine
            .handle
            .blocks_for_frame(seq + 100)
            .unwrap()
            .recv_timeout(Duration::from_secs(3))
            .unwrap()
            .is_err());
        engine.input.shutdown();
        engine.thread.join().unwrap();
    }
}

#[cfg(all(test, feature = "ghostty-engine"))]
mod block_action_actor_tests {
    use super::block_actions::{BlockCommand, BlockReply};
    use super::selection::SelectionCommand;
    use super::*;
    const WAIT: Duration = Duration::from_secs(3);
    fn fixture(enabled: bool) -> Engine {
        let engine = start_with_shell(
            30,
            5,
            None,
            ShellConfig {
                token: shell::ShellToken::for_test(),
                blocks: enabled,
            },
            Box::new(|_| true),
            Box::new(|_| {}),
        )
        .unwrap();
        assert!(engine.input.feed(b"\x1b]133;C;aid=1234567890abcdef1234567890abcdef\x07banana banana\x1b]133;D;0;aid=1234567890abcdef1234567890abcdef\x07\r\n\x1b]133;C;aid=1234567890abcdef1234567890abcdef\x07banana elsewhere\x1b]133;D;0;aid=1234567890abcdef1234567890abcdef\x07".to_vec()));
        engine
            .input
            .finish()
            .unwrap()
            .recv_timeout(WAIT)
            .unwrap()
            .unwrap();
        engine
    }
    #[test]
    fn actor_uses_native_block_actions_after_eof_and_resets_navigation_on_manual_selection() {
        let engine = fixture(true);
        let selected = engine
            .handle
            .block_action(BlockCommand::Select {
                block_id: "b1".into(),
            })
            .unwrap()
            .recv_timeout(WAIT)
            .unwrap()
            .unwrap();
        assert!(
            matches!(selected,BlockReply::Selection{applied:true,block_id:Some(ref id),selection:Some(ref value)}
            if id=="b1" && value=="banana banana")
        );
        let found = engine
            .handle
            .block_action(BlockCommand::Find {
                block_id: "b1".into(),
                query: "ana".into(),
            })
            .unwrap()
            .recv_timeout(WAIT)
            .unwrap()
            .unwrap();
        assert!(matches!(found,BlockReply::Matches{matches,..} if matches.len()==4));
        engine
            .handle
            .selection(SelectionCommand::Word { col: 0, row: 1 })
            .unwrap()
            .recv_timeout(WAIT)
            .unwrap()
            .unwrap();
        let reply = engine
            .handle
            .block_action(BlockCommand::Navigate { direction: 1 })
            .unwrap()
            .recv_timeout(WAIT)
            .unwrap()
            .unwrap();
        assert!(
            matches!(reply,BlockReply::Selection{applied:false,selection:Some(ref value),..} if value=="banana")
        );
        let handle = engine.handle.clone();
        engine.input.shutdown();
        engine.thread.join().unwrap();
        assert!(handle.block_action(BlockCommand::ClearSearch).is_err());
    }
    #[test]
    fn an_abandoned_block_receipt_cannot_overtake_a_later_manual_selection() {
        use std::sync::{mpsc, Arc, Condvar, Mutex};
        let gate = Arc::new((Mutex::new(false), Condvar::new()));
        let waiting = gate.clone();
        let (entered, began) = mpsc::channel();
        let (presented, first) = mpsc::channel();
        let mut frames = 0;
        let engine = start_with_shell(
            30,
            5,
            None,
            ShellConfig {
                token: shell::ShellToken::for_test(),
                blocks: true,
            },
            Box::new(move |bytes| {
                frames += 1;
                if frames == 1 {
                    presented
                        .send(super::frame::decode::decode(&bytes).seq)
                        .unwrap();
                }
                if frames == 2 {
                    entered.send(()).unwrap();
                    let (open, wake) = &*waiting;
                    let mut open = open.lock().unwrap();
                    while !*open {
                        open = wake.wait(open).unwrap();
                    }
                }
                true
            }),
            Box::new(|_| {}),
        )
        .unwrap();
        engine.handle.credit(first.recv_timeout(WAIT).unwrap());
        assert!(engine.input.feed(b"\x1b]133;C;aid=1234567890abcdef1234567890abcdef\x07output\x1b]133;D;0;aid=1234567890abcdef1234567890abcdef\x07".to_vec()));
        began.recv_timeout(WAIT).unwrap();
        let abandoned = engine
            .handle
            .block_action(BlockCommand::Select {
                block_id: "b1".into(),
            })
            .unwrap();
        drop(abandoned); // The IPC waiter can time out without cancelling accepted work.
        let manual = engine.handle.selection(SelectionCommand::Clear).unwrap();
        let (open, wake) = &*gate;
        *open.lock().unwrap() = true;
        wake.notify_all();
        assert_eq!(manual.recv_timeout(WAIT).unwrap().unwrap(), None);
        let current = engine
            .handle
            .selection(SelectionCommand::Read)
            .unwrap()
            .recv_timeout(WAIT)
            .unwrap()
            .unwrap();
        engine.input.shutdown();
        engine.thread.join().unwrap();
        assert_eq!(
            current, None,
            "accepted requests must retain their arrival order after an abandoned receipt"
        );
    }
    #[test]
    fn scoped_search_merges_and_clears_real_frame_colors_without_changing_selection() {
        use super::frame::{
            decode::{decode, Frame},
            set_rgb,
        };
        use super::search::SearchCommand;
        use std::sync::mpsc::{channel, Receiver};
        fn colors(frame: &Frame, row: u16) -> Vec<u32> {
            frame
                .row(row)
                .map(|row| {
                    row.runs
                        .iter()
                        .flat_map(|&(id, len)| {
                            std::iter::repeat_n(frame.styles[usize::from(id)].bg, usize::from(len))
                        })
                        .collect()
                })
                .unwrap_or_default()
        }
        fn painted(engine: &Engine, rx: &Receiver<Vec<u8>>, expected: impl Fn(&Frame) -> bool) {
            let deadline = std::time::Instant::now() + WAIT;
            loop {
                let bytes = rx
                    .recv_timeout(deadline.saturating_duration_since(std::time::Instant::now()))
                    .unwrap();
                let frame = decode(&bytes);
                engine.handle.credit(frame.seq);
                if expected(&frame) {
                    return;
                }
            }
        }
        let (tx, rx) = channel();
        let engine = start_with_shell(
            30,
            5,
            None,
            ShellConfig {
                token: shell::ShellToken::for_test(),
                blocks: true,
            },
            Box::new(move |bytes| tx.send(bytes).is_ok()),
            Box::new(|_| {}),
        )
        .unwrap();
        assert!(engine.input.feed(b"\x1b]133;C;aid=1234567890abcdef1234567890abcdef\x07banana banana\x1b]133;D;0;aid=1234567890abcdef1234567890abcdef\x07\r\nbanana elsewhere".to_vec()));
        engine
            .input
            .finish()
            .unwrap()
            .recv_timeout(WAIT)
            .unwrap()
            .unwrap();
        for bytes in rx.try_iter() {
            engine.handle.credit(decode(&bytes).seq);
        }
        assert!(engine
            .handle
            .search(SearchCommand::Find {
                query: "elsewhere".into(),
                forward: true,
                incremental: true
            })
            .unwrap()
            .recv_timeout(WAIT)
            .unwrap()
            .unwrap());
        let found = engine
            .handle
            .block_action(BlockCommand::Find {
                block_id: "b1".into(),
                query: "ana".into(),
            })
            .unwrap()
            .recv_timeout(WAIT)
            .unwrap()
            .unwrap();
        let version = match found {
            BlockReply::Matches { version, matches } => {
                assert_eq!(matches.len(), 4);
                version
            }
            _ => panic!("expected matches"),
        };
        let ordinary = set_rgb(0x51, 0x5c, 0x6a);
        let active = set_rgb(0xd1, 0x86, 0x16);
        painted(&engine, &rx, |frame| {
            colors(frame, 0).get(1) == Some(&ordinary) && colors(frame, 1).get(7) == Some(&active)
        });
        assert!(matches!(
            engine
                .handle
                .block_action(BlockCommand::Reveal { version, index: 0 })
                .unwrap()
                .recv_timeout(WAIT)
                .unwrap()
                .unwrap(),
            BlockReply::Revealed { found: true }
        ));
        painted(&engine, &rx, |frame| {
            colors(frame, 0).get(1) == Some(&active)
        });
        engine
            .handle
            .block_action(BlockCommand::ClearSearch)
            .unwrap()
            .recv_timeout(WAIT)
            .unwrap()
            .unwrap();
        painted(&engine, &rx, |frame| {
            colors(frame, 0)
                .get(1)
                .is_some_and(|color| *color != ordinary && *color != active)
                && colors(frame, 1).get(7) == Some(&active)
        });
        assert_eq!(
            engine
                .handle
                .selection(SelectionCommand::Read)
                .unwrap()
                .recv_timeout(WAIT)
                .unwrap()
                .unwrap(),
            None
        );
        engine.input.shutdown();
        engine.thread.join().unwrap();
    }
    #[test]
    fn disabled_block_actions_fail_explicitly() {
        let engine = fixture(false);
        assert!(engine
            .handle
            .block_action(BlockCommand::ClearSearch)
            .unwrap()
            .recv_timeout(WAIT)
            .unwrap()
            .unwrap_err()
            .contains("not enabled"));
        engine.input.shutdown();
        engine.thread.join().unwrap();
    }
}

#[cfg(all(test, feature = "ghostty-engine"))]
mod clipboard_actor_tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    const WAIT: Duration = Duration::from_secs(5);

    #[test]
    fn ordinary_and_blocks_copy_fragmented_final_output_independently_of_draw_credits() {
        for blocks in [false, true] {
            let engine = start_with_shell(
                40,
                3,
                None,
                ShellConfig {
                    token: shell::ShellToken::for_test(),
                    blocks,
                },
                Box::new(|_| true),
                Box::new(|_| {}),
            )
            .unwrap();
            let notices = Arc::new(AtomicUsize::new(0));
            let count = notices.clone();
            engine.handle.on_clipboard(move || {
                count.fetch_add(1, Ordering::SeqCst);
                true
            });
            for bytes in [
                b"text\x1b]52;pc;Y2Fm ".as_slice(),
                b"w6k=\x1b",
                b"\\\x1b]52;c;?\x07\x1b]52;p;YmFk\x07\x1b]52;c;!!!!\x07 done",
            ] {
                assert!(engine.input.feed(bytes.to_vec()));
            }
            engine
                .input
                .finish()
                .unwrap()
                .recv_timeout(WAIT)
                .unwrap()
                .unwrap();
            assert_eq!(notices.load(Ordering::SeqCst), 1);
            assert_eq!(
                engine.handle.take_clipboard_write().as_deref(),
                Some("caf\u{e9}")
            );
            assert!(engine.handle.take_clipboard_write().is_none());
            assert!(!engine.handle.input_state().shell.shell_ready);
            engine.input.shutdown();
            engine.thread.join().unwrap();
            assert!(engine.handle.take_clipboard_write().is_none());
        }
    }

    #[test]
    fn a_failed_clipboard_receiver_does_not_fail_terminal_output_or_finalization() {
        let engine = start(40, 3, Box::new(|_| true), Box::new(|_| {})).unwrap();
        engine.handle.on_clipboard(|| false);
        assert!(engine
            .input
            .feed(b"\x1b]52;c;YQ==\x07healthy output".to_vec()));
        engine
            .input
            .finish()
            .unwrap()
            .recv_timeout(WAIT)
            .unwrap()
            .unwrap();
        assert!(engine
            .handle
            .read_text(3)
            .unwrap()
            .recv_timeout(WAIT)
            .unwrap()
            .unwrap()
            .contains("healthy output"));
        assert!(engine.handle.take_clipboard_write().is_none());
        engine.input.shutdown();
        engine.thread.join().unwrap();
    }
}
