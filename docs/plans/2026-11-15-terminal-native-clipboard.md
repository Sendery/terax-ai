# Native terminal clipboard writes

## Behavior and scope

Ordinary and blocks native sessions preserve terminal-origin OSC52 text writes
without routing VT output through another JavaScript parser. The existing Rust
shell integration framer observes an optional bounded clipboard sink. Its pure
decoder preserves the legacy clipboard policy: empty or c-containing selectors,
standard forgiving base64 including ECMAScript whitespace and optional padding,
strict UTF8, NUL and initial BOM handling. Raw empty payloads, queries, unsupported
selectors, malformed base64, invalid UTF8 and oversized data leave the previous
valid pending copy intact. Whitespace-only encoded input retains legacy explicit
empty-text behavior.

The decoded text limit is 1 MiB. Encoded UTF16 units are bounded using the legacy
formula. The raw OSC buffer also includes a bound for UTF8 whitespace expansion,
the opcode and a selector capped at 4096 bytes. This explicit selector cap is
stricter than the legacy handler's whole-OSC-only limit. No arbitrary selector
growth, OS clipboard reads, query replies, public Pi/MCP command or new dependency
is introduced.

The mailbox retains the latest valid text and at most one outstanding constant
notification until taken. The optional startup channel carries no text. A custom
internal command takes one pending write for an existing native session. The
client serializes writes independently of rendering credits and rechecks the
owning session after async reads and immediately before platform writes,
including a deferred Linux plugin import and the web fallback. Close, engine
failure and stale opening discard pending work; healthy process exit can still
deliver its final copy. Failed clipboard delivery never fails terminal output.

## Compatibility and trust

The core-only clipboard callback is insufficient for Terax policy: the pinned
core normalizes pc to primary and rejects whitespace in base64. Those cases
remain in tests; the implementation uses the existing raw OSC framer instead.

Shared fixtures run against the installed xterm parser and the native observer
at every UTF8 byte boundary. They cover ESC with C0/DEL, ignored C0 in OSC payload,
Unicode C1 OSC/ST and ESC termination, cancellation, combined selectors and
whitespace. Tolerant clipboard paths are marked clipboard-only and cannot
authorize OSC7/133 shell state, even with a valid shell token. Existing strict
shell and opaque-string policies remain in force.

Optional Tauri channels use a deserializable JavaScriptChannelId converted on
the invoking Webview; Option<Channel<T>> is not a supported command argument.

## Verification on M2

All source, checks, builds and runtime acceptance used the isolated
native-clipboard worktree on M2. The original protected Mac was not built or
modified. No GitHub Actions, pushes, pull requests or merges were used.

Focused frontend and native checks cover the actor, startup, final output,
coalescing, decoder boundaries, malformed requests, reentrant subscribers,
closed/failed owners, real xterm framing and deferred platform writes. Logs are
retained under .terax/pi-development/m2/logs/clipboard-*.

The frozen prototype sandbox was authenticated using app.buildInfo, discovery
PID, exact mapped executable and the existing public clean tab set. A temporary
ZDOTDIR launched only public fixtures in the two native split leaves, without
editing the user's shell profiles. The clipboard was first overwritten with a
known public seed; readback compared only expected public values and never
printed prior clipboard contents.

All five real macOS phases passed:

| Phase | Expected behavior | Result |
| --- | --- | --- |
| 1 | pc selector copies 36-byte multiline accented text | Passed |
| 2 | query, primary-only, malformed base64 and invalid UTF8 preserve copy | Passed |
| 3 | UTF8 Unicode C1 OSC/ST copies 13-byte text | Passed |
| 4 | exactly 1 MiB decoded text reaches the system clipboard | Passed |
| 5 | whitespace-only encoded payload produces legacy empty text | Passed |

The existing WebKit clipboard writer worked without a new plugin or permission.
Native Linux/Windows runtime acceptance is separate and remains unverified.
The fixture override is removed for the normal sandbox launch. No performance
experiments are required by this block; the user considers 60 FPS optional.
This closes the implemented OSC52 slice, not the overall terminal migration or
production-default rollout.
