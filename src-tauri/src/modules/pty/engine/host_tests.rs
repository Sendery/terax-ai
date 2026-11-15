//! Actor-level host mutations: real frames and applied receipts, not mock ACKs.
use super::{
    frame::{
        decode::{decode, Frame},
        FLAG_FULL,
    },
    selection::SelectionCommand,
    shell::ShellToken,
    start_with_shell_options, Engine, EngineOptions, ShellConfig,
};
use std::sync::mpsc::{self, Receiver};
use std::time::{Duration, Instant};

fn actor(blocks: bool, scrollback_rows: u32) -> (Engine, Receiver<Vec<u8>>) {
    let (tx, rx) = mpsc::channel();
    let engine = start_with_shell_options(
        12,
        3,
        EngineOptions {
            scrollback_rows: Some(scrollback_rows),
            ..EngineOptions::default()
        },
        ShellConfig {
            token: ShellToken::for_test(),
            blocks,
        },
        Box::new(move |frame| tx.send(frame).is_ok()),
        Box::new(|_| {}),
    )
    .unwrap();
    (engine, rx)
}
fn frame(rx: &Receiver<Vec<u8>>) -> Frame {
    decode(&rx.recv_timeout(Duration::from_secs(5)).unwrap())
}
fn wait_feed(engine: &Engine, bytes: u64) {
    let deadline = Instant::now() + Duration::from_secs(5);
    while engine.handle.stats().bytes_fed < bytes {
        assert!(
            Instant::now() < deadline,
            "actor did not process fixture output"
        );
        assert_eq!(engine.handle.failure(), None);
        std::thread::sleep(Duration::from_millis(2));
    }
}
fn selection(engine: &Engine, command: SelectionCommand) -> Option<String> {
    engine
        .handle
        .selection(command)
        .unwrap()
        .recv_timeout(Duration::from_secs(5))
        .unwrap()
        .unwrap()
}
#[test]
fn rows_apply_before_receipt_and_keep_selection_while_old_frames_are_invalidated() {
    for blocks in [false, true] {
        let (engine, frames) = actor(blocks, 300);
        let first = frame(&frames);
        assert_eq!(engine.handle.input_state().host.scrollback_rows, Some(300));
        assert_eq!(engine.handle.input_state().host.host_mutation_version, 0);
        let output = (0..350)
            .map(|i| format!("r{i:03}"))
            .collect::<Vec<_>>()
            .join("\r\n");
        assert!(engine.input.feed(output.as_bytes().to_vec()));
        wait_feed(&engine, output.len() as u64);
        assert_eq!(
            engine.handle.stats().scrollback_rows,
            Some(300),
            "startup policy must precede initial output"
        );
        engine.handle.credit(first.seq);
        let before = frame(&frames);
        assert!(engine
            .handle
            .link_context(before.seq, 1, 2)
            .unwrap()
            .recv_timeout(Duration::from_secs(5))
            .unwrap()
            .unwrap()
            .is_some());
        assert_eq!(
            selection(&engine, SelectionCommand::Word { col: 1, row: 2 }),
            Some("r349".into())
        );

        let (tx, states) = mpsc::channel();
        engine.handle.on_state(move |value| tx.send(value).is_ok());
        engine.handle.set_scrollback_rows(200).unwrap();
        let applied = loop {
            let value = states.recv_timeout(Duration::from_secs(5)).unwrap();
            if value.host.host_mutation_version > 0 {
                break value;
            }
        };
        assert_eq!(applied.host.scrollback_rows, Some(200));
        assert_eq!(applied.host.host_mutation_version, 1);
        assert_eq!(applied.host.host_mutation_after_seq, before.seq);
        assert_eq!(engine.handle.stats().scrollback_rows, Some(200));
        assert_eq!(
            selection(&engine, SelectionCommand::Read),
            Some("r349".into())
        );
        assert!(engine
            .handle
            .link_context(before.seq, 1, 2)
            .unwrap()
            .recv_timeout(Duration::from_secs(5))
            .unwrap()
            .unwrap()
            .is_none());
        assert!(
            frames.try_recv().is_err(),
            "the old frame still owns credit"
        );
        engine.handle.credit(before.seq);
        let after = frame(&frames);
        assert_ne!(after.seq, applied.host.host_mutation_after_seq);
        assert_ne!(after.flags & FLAG_FULL, 0);
        assert!(engine
            .handle
            .link_context(after.seq, 1, 2)
            .unwrap()
            .recv_timeout(Duration::from_secs(5))
            .unwrap()
            .unwrap()
            .is_some());

        let changed = engine
            .handle
            .clear()
            .unwrap()
            .recv_timeout(Duration::from_secs(5))
            .unwrap()
            .unwrap();
        assert!(changed);
        let clear = engine.handle.input_state().host;
        assert_eq!(
            clear.host_mutation_version, 2,
            "state publication precedes the applied bool reply"
        );
        assert_eq!(clear.host_mutation_after_seq, after.seq);
        assert_eq!(clear.scrollback_rows, Some(200));
        assert_eq!(engine.handle.stats().scrollback_rows, Some(0));
        engine.handle.credit(after.seq);
        let cleared = frame(&frames);
        assert_ne!(cleared.flags & FLAG_FULL, 0);
        assert_eq!(
            selection(&engine, SelectionCommand::Word { col: 1, row: 0 }),
            Some("r349".into())
        );
        assert!(!engine
            .handle
            .clear()
            .unwrap()
            .recv_timeout(Duration::from_secs(5))
            .unwrap()
            .unwrap());
        assert_eq!(
            engine.handle.input_state().host,
            clear,
            "no-op leaves the host receipt intact"
        );
        assert_eq!(
            selection(&engine, SelectionCommand::Read),
            Some("r349".into())
        );
        assert!(
            engine
                .handle
                .link_context(cleared.seq, 1, 0)
                .unwrap()
                .recv_timeout(Duration::from_secs(5))
                .unwrap()
                .unwrap()
                .is_some(),
            "no-op must retain current frame contexts"
        );
        engine.handle.credit(cleared.seq);
        engine.input.shutdown();
        assert_eq!(engine.thread.join(), Ok(()));
    }
}
#[test]
fn policy_increase_is_lazy_and_publishes_without_output_or_trim() {
    let (engine, frames) = actor(false, 2000);
    let first = frame(&frames);
    engine.handle.set_scrollback_rows(50_000).unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    while engine.handle.input_state().host.scrollback_rows != Some(50_000) {
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(2));
    }
    let applied = engine.handle.input_state().host;
    assert_eq!(applied.host_mutation_version, 1);
    assert_eq!(applied.host_mutation_after_seq, first.seq);
    assert_eq!(engine.handle.stats().scrollback_rows, Some(0));
    engine.handle.set_scrollback_rows(50_000).unwrap();
    let barrier = engine.handle.selection(SelectionCommand::Read).unwrap();
    assert!(barrier
        .recv_timeout(Duration::from_secs(5))
        .unwrap()
        .is_ok());
    assert_eq!(engine.handle.input_state().host, applied);
    assert!(engine.handle.set_scrollback_rows(199).is_err());
    engine.handle.credit(first.seq);
    let next = frame(&frames);
    engine.handle.credit(next.seq);
    engine.input.shutdown();
    assert_eq!(engine.thread.join(), Ok(()));
}
