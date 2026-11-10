use libghostty_vt::{RenderState, Terminal, TerminalOptions};

fn main() {
    let mut terminal = Terminal::new(TerminalOptions {
        cols: 80,
        rows: 24,
        max_scrollback: 1000,
    })
    .expect("create terminal");
    terminal.vt_write(b"Hello, prebuilt!\x1b[31mRed\x1b[0m\r\n");
    let mut render = RenderState::new().expect("create render state");
    let snapshot = render.update(&terminal).expect("render terminal");
    assert_eq!(snapshot.cols().unwrap(), 80);
    assert_eq!(snapshot.rows().unwrap(), 24);
    println!("prebuilt terminal create/feed/render succeeded");
}
