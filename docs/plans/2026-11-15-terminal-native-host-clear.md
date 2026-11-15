# Native host clear core

The existing Cmd+K action keeps the complete cursor row, moves it to row zero,
preserves X and blanks all other rows with default attributes. It is distinct
from the Mod+; formfeed action already integrated as cea3fa6.

The isolated native-host-clear worktree contains an additive source extension
in scripts/libghostty/host-clear. It prepares replacement grid storage before
committing, preserves current pen, hyperlink identity, pending wrap, modes,
margins and saved cursor, and invalidates old tracked C references only in the
active buffer. It clears active image placements while retaining image data
and quotas. It sends no input to the PTY. The original xterm early no-op is
preserved exactly, including content below row zero and existing references.

Astra found no source blocker and requested managed-allocation and real-history
coverage. Both were added. The final native gate passes71/71 tests across the
two lib-vt roots, with nine explicit host-clear behavior tests. Allocation
injection covers styles, graphemes and OSC8, including a current pen and link
different from the retained cells. Other cases exercise displaced viewport,
alternate-buffer isolation, default blank cells, marker invalidation, image
reuse, saved cursor and pending wrap.

The directed gate used checksum-pinned Zig0.15.2 and the verified official Apple
CLT16.2/SDK15.2, selected only for that process through DEVELOPER_DIR. System
paths precede inherited tools. The command was:

    zig build test-lib-vt --summary all -Dtest-filter="host clear:" -j2
      -Demit-lib-vt=true -Doptimize=Debug -Dcpu=baseline
      -Demit-xcframework=false -Dapp-runtime=none
      --global-cache-dir <completed-history-producer-cache>

Formatting was limited to edited Zig files. git diff --check passes for the
source, and added code lines in the unified patch were checked separately for
trailing whitespace. No SDK, compiler or native artifact is tracked here.

This checkpoint is a core candidate, not delivered Cmd+K parity. The normal
app still uses its previous prebuilt, whose ABI does not have this endpoint.
A combined source-reviewed history/host-clear artifact, compatible deployment
target, safe Rust wrapper and owned actor/frontend adapters are still required.
The combined native suite and ordinary WebKit interaction are pending. Do not
probe the new symbol against an old library or replace this behavior with
Ctrl+L/reset.
