//! Terminal engine (`docs/architecture/terminal-engine.md`). One libghostty
//! `Terminal` per session, owned by its own thread, fed through a bounded
//! queue and drained into frames only while the webview holds out a credit.
//!
//! `frame` and the pump bookkeeping in `Pump` are pure and build without the
//! `ghostty-engine` feature; everything that touches libghostty is gated.

pub mod frame;

#[cfg(feature = "ghostty-engine")]
pub mod bench;
#[cfg(feature = "ghostty-engine")]
mod snapshot;

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
    use std::sync::mpsc::{sync_channel, Receiver, RecvTimeoutError, SyncSender};
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
    use super::snapshot::Snapshotter;
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

    pub(super) enum Input {
        Bytes(Vec<u8>),
        Wake,
        Shutdown,
    }

    // Commands from the webview never wait on the byte queue: they land here,
    // coalesced, and a non-blocking wake makes the engine look.
    #[derive(Default)]
    struct Control {
        ack: Option<u32>,
        resize: Option<(u16, u16)>,
        colors: Option<Colors>,
        scroll: i64,
        full: bool,
    }

    #[derive(Default)]
    struct Stats {
        bytes_fed: AtomicU64,
        frames: AtomicU64,
        frame_bytes: AtomicU64,
        encode_micros: AtomicU64,
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
    }

    impl EngineHandle {
        pub fn credit(&self, seq: u32) {
            self.update(|c| c.ack = Some(seq));
        }

        pub fn set_colors(&self, colors: Colors) {
            self.update(|c| c.colors = Some(colors));
        }

        pub fn resize(&self, cols: u16, rows: u16) {
            self.update(|c| c.resize = Some((cols, rows)));
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
    }

    impl EngineInput {
        /// Blocks while the queue is full. False when the engine is gone.
        pub fn feed(&self, bytes: Vec<u8>) -> bool {
            self.tx.send(Input::Bytes(bytes)).is_ok()
        }

        /// Queued behind every byte already fed, so the final frame shows them.
        pub fn shutdown(&self) {
            let _ = self.tx.send(Input::Shutdown);
        }
    }

    pub struct EngineThread(JoinHandle<()>);

    impl EngineThread {
        pub fn join(self) {
            if let Err(e) = self.0.join() {
                log::error!("terminal engine thread panicked: {e:?}");
            }
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

    pub fn start_with_colors(
        cols: u16,
        rows: u16,
        colors: Option<Colors>,
        frames: FrameSink,
        replies: ReplySink,
    ) -> Result<Engine, String> {
        validate_size(cols, rows)?;
        let (tx, rx) = sync_channel(QUEUE_DEPTH);
        let (ready_tx, ready_rx) = sync_channel(1);
        let control = Arc::new(Mutex::new(Control::default()));
        let stats = Arc::new(Stats::default());
        let thread = {
            let control = control.clone();
            let stats = stats.clone();
            thread::Builder::new()
                .name("terax-pty-engine".into())
                .spawn(move || {
                    run(
                        cols, rows, colors, rx, control, stats, frames, replies, ready_tx,
                    )
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
            },
            input: EngineInput { tx },
            thread: EngineThread(thread),
        })
    }

    struct Session<'cb> {
        term: Terminal<'static, 'cb>,
        snapshot: Snapshotter,
        pump: Pump,
        size: (u16, u16),
        frames: FrameSink,
        sink_open: bool,
        replies: &'cb RefCell<Vec<u8>>,
        reply_sink: ReplySink,
        control: Arc<Mutex<Control>>,
        stats: Arc<Stats>,
    }

    impl Session<'_> {
        fn feed(&mut self, bytes: &[u8]) {
            self.term.vt_write(bytes);
            self.update_scrollback_rows();
            self.flush_replies();
            self.stats
                .bytes_fed
                .fetch_add(bytes.len() as u64, Ordering::Relaxed);
            self.pump.output();
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
                (self.reply_sink)(&buf);
                buf.clear();
            }
        }

        fn apply_control(&mut self) {
            let c =
                std::mem::take(&mut *self.control.lock().unwrap_or_else(PoisonError::into_inner));
            if let Some((cols, rows)) = c.resize {
                if (cols, rows) != self.size && validate_size(cols, rows).is_ok() {
                    match self.term.resize(cols, rows, 0, 0) {
                        Ok(()) => {
                            self.size = (cols, rows);
                            self.update_scrollback_rows();
                            self.pump.request_full();
                            self.flush_replies();
                        }
                        Err(e) => log::warn!("terminal engine resize to {cols}x{rows} failed: {e}"),
                    }
                }
            }
            if let Some(colors) = c.colors {
                match colors.apply(&mut self.term) {
                    Ok(()) => self.pump.request_full(),
                    Err(e) => log::warn!("terminal engine colors failed: {e}"),
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
            let started = Instant::now();
            let seq = self.pump.next_seq();
            let built = match self
                .snapshot
                .build(&self.term, seq, self.pump.full_pending())
            {
                Ok(Some(frame)) => frame.to_vec(),
                Ok(None) => {
                    self.pump.nothing_changed();
                    return;
                }
                Err(e) => {
                    log::warn!("terminal engine snapshot failed: {e}");
                    self.pump.nothing_changed();
                    return;
                }
            };
            let encode = started.elapsed();
            let len = built.len() as u64;
            if !(self.frames)(built) {
                log::debug!("terminal engine frame channel closed; no more frames");
                self.sink_open = false;
                return;
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
            if !self.sink_open {
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

        // The stream has ended, so the last frame goes out without waiting for
        // a credit: nothing can follow it.
        fn finish(&mut self) {
            self.apply_control();
            if self.sink_open && self.pump.has_pending() {
                self.emit();
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn run(
        cols: u16,
        rows: u16,
        colors: Option<Colors>,
        rx: Receiver<Input>,
        control: Arc<Mutex<Control>>,
        stats: Arc<Stats>,
        frames: FrameSink,
        reply_sink: ReplySink,
        ready: SyncSender<Result<(), String>>,
    ) {
        let replies = RefCell::new(Vec::new());
        let setup = || -> Result<(Terminal<'static, '_>, Snapshotter), libghostty_vt::Error> {
            let mut term = Terminal::new(TerminalOptions {
                cols,
                rows,
                max_scrollback: SCROLLBACK_BYTES,
            })?;
            if let Some(colors) = &colors {
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
        let mut session = Session {
            term,
            snapshot,
            pump: Pump::new(),
            size: (cols, rows),
            frames,
            sink_open: true,
            replies: &replies,
            reply_sink,
            control,
            stats,
        };
        session.update_scrollback_rows();
        let _ = ready.send(Ok(()));
        loop {
            let message = match session.tick() {
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
                Input::Shutdown => {
                    session.finish();
                    return;
                }
            }
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
            self.thread.join();
            self.frames
        }
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
        engine.thread.join();
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
        thread.join();
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
}
