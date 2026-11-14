use libghostty_vt::{Terminal, TerminalOptions, alloc::Allocator};
use std::cell::RefCell;

#[path = "../../../../src-tauri/src/modules/pty/engine/frame.rs"]
pub mod frame;
#[path = "../target/snapshot.rs"]
mod snapshot;

thread_local! {
    static LAST_FRAME: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
}

#[unsafe(no_mangle)]
pub extern "C" fn run_case(which: u32) -> u32 {
    LAST_FRAME.with_borrow_mut(Vec::clear);
    let (cols, rows, input): (u16, u16, &[u8]) = match which {
        0 => (24, 4, b"hello\r\nworld"),
        1 => (
            16,
            3,
            concat!(
                "\x1b[38;2;255;128;0morange\x1b[0m \x1b[48;2;0;64;128mnavy\x1b[0m\r\n",
                "\x1b[4;58;2;10;20;30mulrgb\x1b[0m\r\n",
                "\x1b[48;2;40;40;40mfill\x1b[K\x1b[0m",
            )
            .as_bytes(),
        ),
        2 => (
            12,
            4,
            "\u{4e2d}\u{6587}ab\r\ne\u{301}x \u{1f680}!\r\n0123456789A\u{4e2d}".as_bytes(),
        ),
        _ => return 0,
    };
    let Ok(mut term) = Terminal::new_with_alloc(
        &Allocator::GLOBAL,
        TerminalOptions {
            cols,
            rows,
            max_scrollback: 100,
        },
    ) else {
        return 0;
    };
    term.vt_write(input);
    let Ok(mut snapshot) = snapshot::Snapshotter::new() else {
        return 0;
    };
    let Ok(Some(bytes)) = snapshot.build(&term, 1, true) else {
        return 0;
    };
    LAST_FRAME.with_borrow_mut(|last| {
        last.extend_from_slice(bytes);
        last.as_ptr() as u32
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn frame_len() -> u32 {
    LAST_FRAME.with_borrow(|last| last.len() as u32)
}

#[unsafe(no_mangle)]
pub extern "C" fn clear_frame() {
    LAST_FRAME.with_borrow_mut(|last| {
        *last = Vec::new();
    });
}
