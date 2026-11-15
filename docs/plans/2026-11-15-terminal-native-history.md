# Native terminal history row preference

Status: source extension and explicit M2 producer verified. The application
preference integration remains pending.
This does not yet implement app-level preference parity and does not change the
currently consumed prebuilt archive.

## Existing behavior and intended result

The existing terminalScrollback preference defaults to 2000 physical history
rows, bounded to 200..50000, and updates legacy renderers live. The native core
currently receives a 16 MiB byte budget. Bytes cannot reliably implement that
row preference.

The prepared extension adds ghostty_terminal_set_scrollback_limit_rows as a new
C function, without changing the layout of GhosttyTerminalOptions or probing an
unknown numeric option against an old ReleaseFast archive. Its primary-screen
policy is persistent, exact, live and lazy. It prunes using the core's own row
and tracked-pin machinery, with no second parser.

See scripts/libghostty/history/README.md and manifest.json for the exact source
patch, provenance, pending safe Rust changes, two-job producer recipe, native
invariants and test commands.

## Current evidence

- Exact source base:a887df42c56f6de86c0fe6da9c4eeca37931e083.
- Reviewed patch SHA256:
  293a47bae00a5fd4c196ab52e550050f784488d883b1fc2ed436263a44ce4973.
- Seven upstream files, eleven added behavior tests; independent apply/hash
  verification and root/Astra reviews passed.
- Node policy suite:9 passed; producer syntax check passed.
- Official unmodified upstream baseline:53 passed.
- Focal native gate:74 passed; full lib-vt suite:4906 passed,34 skipped.
- ReleaseFast library and additive export verified on M2.
- Variant archive:
  libghostty-vt-0.2.2-a887df4-terax-history1-293a47bae00a-aarch64-macos.tar.gz.
- Archive SHA256:
  efa0706adf79151111af8a0605121126b02056310abe44dda9cd062a66ca97c6.
- Archive 2798832 bytes, static library 8885840 bytes.
- All 11 observed Mach-O build-version records have minimum macOS 13.0.
  This is an experimental M2/macOS 13+ artifact. It does not establish the
  application's broader macOS 10.15 or arm64 11 deployment compatibility.
- The producer uses checksum-pinned Zig 0.15.2 and real Apple CLT 16.2/SDK 15.2,
  selected by DEVELOPER_DIR only for that process. Package signatures,
  compressed-XAR-TOC digests and full SHA256 hashes were verified first.
  Apple SDKs/installers are not included in Git or the native archive.
- Source setup initially failed against SDK 27 before any test ran. The same
  build-runner failure reproduced in untouched upstream. An unavailable
  --debug-libc route was stopped on its disabled warning. Neither is described
  as a failing history behavior test; the verified official CLT route resolved
  producer compatibility without changing SDK files or xcrun.
- No Cargo, application UI/runtime, Actions, push or publishing ran for this
  block. Consumer pins, active bindings, Cargo manifests and lockfiles remain
  unchanged. App-level row preference parity remains open.
- No constant peak-memory guarantee during upstream reflow is claimed.

## Integration after a verified artifact

The existing preference must reach ordinary/blocks engine sessions before first
output, update through the actor on actual changes, and survive pending open,
respawn and view/renderer changes. Actor reads must refresh real history counts,
invalidate stale search/selection tokens and mark evicted block anchors as
unavailable. These consumer changes must only land with a separately pinned
compatible archive. Normal app builds must remain prebuilt-only with no Zig
execution or source fallback.

The 60 FPS target is unrelated to this functional parity requirement.

## Raw-reference contract correction

Upstream CGridRef carries size/node/x/y, with no captured page serial. Its
contract (terminal.h:1549) permits access only until the next mutation, and the
safe Rust snapshot lifetime is tied to that terminal borrow. No stale-raw-ref
detection guarantee is added by this extension.

The original written test queried an expired raw ref after pruning. Its
no_value expectation could pass merely because the old y coordinate fell out
of history into active rows, not because generation invalidation was detected.
The corrected test ends the initial borrow before mutation, rejects a fresh
snapshot of the evicted tracked ref, and reconstructs a fresh snapshot of the
survivor to verify its remapped point and original unique codepoint. This
strengthens the retained-content/no-alias evidence without changing the ABI.
