# Host clear candidate

Source candidate only. No native test, library artifact, Rust wrapper, Tauri
command or product integration is claimed by these files. The candidate is
prepared in a separate M2 worktree while the history producer owns the native
compiler lease.

The new operation implements the existing Cmd+K host-buffer contract. It does
not send Ctrl+L. It prepares one managed cursor row plus default blank active
rows before touching the old grid, so preparation failures leave that grid
intact. It preserves X, wrap, current pen/hyperlink identity, saved cursor,
modes, margins and inactive-buffer state. It clears active selection and
placements, retains transmitted images and quotas, then replaces grid storage.
The active screen generation invalidates old tracked C references safely.
Raw C references retain their existing borrow-until-mutation contract.

The early no-op when history and Y are zero preserves storage, markers and
generations, including content below the cursor row. The optional C output
reports whether a change occurred so the actor can avoid false cleanup.

Nine behavior tests pass in the focused lib-vt roots:71/71 tests,21/21 build
steps, using checksum-pinned Zig0.15.2 and the isolated official Apple CLT16.2
SDK15.2 through per-process DEVELOPER_DIR. The whole lib-vt suite has not been
rerun for this separate candidate; it must run on the eventual combined artifact. The app remains on its
verified old prebuilt. This endpoint cannot be probed or linked against that
artifact; a new explicitly identified combined artifact and safe wrapper are
required before product integration.

Astra reviewed the core source. The added managed allocator-failure and real
history/displaced-viewport scenarios pass. Assertions also verify retained cell
style/hyperlink data independently of a different current pen and preserve
tracked-reference no-op/inactive-buffer behavior. Two initial C fixture options
and one test pointer comparison were corrected during the directed gates;
no failed pass was recorded as success.

Next: compose with the exact history-row extension, run the combined native
suite and library export/link validation, then actor/frontend adapters and
normal-app acceptance. Actor and frontend
must invalidate stale selection/search/block projections and request a full
frame only after a successful mutation. No release or complete parity claim.
