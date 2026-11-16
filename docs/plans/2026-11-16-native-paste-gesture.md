# Native terminal keyboard paste

The native macOS terminal now leaves Cmd+V to the browser's normal paste gesture.
Its existing textarea paste listener consumes `text/plain` once and prevents
textarea insertion. It does not request clipboard text through the Web Clipboard
API during keydown. Copy behavior and terminal key encoding remain unchanged.

The previous programmatic read entered WebKit's `requestDOMPasteAccess` native
menu in real M2 acceptance, with no bytes reaching the receiving PTY. Cancelling
that menu restored the app. This was a clipboard gesture issue, not a terminal
process panic. The coordinated QA owner supplied this runtime evidence.

Linux/Windows keep the existing Ctrl+Shift+V and Shift+Insert policy. Those
keydown handlers cancel default delivery and use the existing helper: native
plugin on Linux, web clipboard on Windows. Direct browser paste events still
work through the shared listener. No new permission or clipboard API is added.

Paste delivery requires the native input to be focused, its pane and document
to be visible, its window to have focus, and its live session to permit input.
An async helper result is discarded after disposal, process exit, session
replacement or loss of that ownership. Empty and previously cancelled paste
events do nothing. Hidden panes cannot read clipboard event data or initiate
a helper read through a stale keyboard callback.

## Line endings

This correction passes clipboard text unchanged to `session.paste`. The existing
Rust encoder normalizes CRLF to LF before libghostty paste encoding. Existing
`paste_normalizes_newlines_and_uses_only_negotiated_brackets` coverage expects
CR for an ordinary paste and LF within negotiated bracketed-paste delimiters.
No frontend newline conversion, extra Enter, Rust change or protocol change is
part of this correction.

## Verification

Focused event-binding tests first failed on the intercepted macOS gesture,
unowned reads/delivery and cancelled-event handling, then passed after the fix.
They cover one plaintext delivery with mixed CRLF/LF/CR, no keyup duplication,
non-Mac helper ownership, stale async results and hidden/exited/disposed inputs.
Existing keyboard, binding and clipboard-helper tests pass; TypeScript and
changed-file lint pass. No clipboard contents are read by the test runner.

Actual packaged WebKit acceptance remains with the coordinated QA owner: focus
a live native terminal receiver, paste a known public multiline fixture, verify
exact expected bytes and responsiveness without a native permission menu, then
repeat after changing pane. If exited output remains mounted, it must reject
paste; intentional auto-close after exit is unchanged. Do not infer this
acceptance from source tests. This isolated pass runs no UI, native builds or
Cargo checks and does not update the already-delivered DMG.
