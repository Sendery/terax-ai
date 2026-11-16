# Exact native scrollback and host clear integration

The native terminal now applies terminalScrollback as exact retained physical
history rows and provides a cursor-row-preserving host clear. This block owns
the combined core, verified local prebuilt, safe Rust wrapper, actor and internal
gterm IPC. The parallel frontend lane owns settings delivery, Cmd+K routing and
capture invalidation. No PTY is restarted and no VT input is synthesized.

## Applied behavior

Ordinary gterm_open accepts optional scrollbackRows, defaults to 2000 and
validates the existing setting range 200..50000 before spawning. EngineOptions
keeps this policy separate from appearance and shell settings. Low-level
benchmark helpers retain their previous byte-budget policy.

gterm_set_scrollback_rows admits the latest coalesced setting. Its IPC ACK is
not an application barrier. Once the actor applies a changed policy, existing
onState publishes applied scrollbackRows, hostMutationVersion and
hostMutationAfterSeq. The latter is the last real frame emitted before mutation,
not a synthetic frame. Frame seq is wrapping u32; consumers compare serials
modulo 2^32. Continuous PTY output does not increment the host mutation version.

gterm_clear shares the bounded FIFO interaction queue with selection and block
operations. It returns changed only after real application and state publication.
A false result preserves selection, markers, caches and the host receipt. An IPC
timeout does not retract already admitted work. A subsequent gterm_state read
after a true reply observes at least that applied receipt.

Exact-row clipping remains owned by Ghostty. The actor resets gesture pins,
invalidates search indexes and old link/block frame contexts, and requests a real
full frame. It retains the clipped core selection. Host pruning does not advance
blocksMetadataVersion, promptVersion or commandRunning. Raw C GridRef remains a
borrow ending at mutation; retained tracked refs must be freshly snapshotted.

## Core and producer provenance

scripts/libghostty/native-core composes the previously reviewed history and
host-clear patches on upstream a887df42c56f6de86c0fe6da9c4eeca37931e083 with
Zig 0.15.2. Nine files have pinned before/after hashes. Core patch SHA256:
46735899626426a334b9c96a5faaed58da3391cd8103c24879fa2e95ff30ad4a.

Twenty existing behavior cases keep their reviewed bodies and receive a common
native core: filter. Three new cases cover retention after clear, primary policy
while alternate is active, and the zero-row policy. The Config change preserves
an explicit deployment minimum only for lib-vt without exe, macOS app,
xcframework or benchmark outputs. The ordinary upstream 13.0 default remains.

The explicit M2 producer used verified signed Apple CLT 16.2 / SDK 15.2 selected
by process-local DEVELOPER_DIR, system tools first on PATH, baseline CPU, two
jobs and target aarch64-macos.11.0. No global SDK, xcode-select or installed app
was changed. App consumers use the prebuilt only; there is no source fallback.

Measured archive: 2,827,833 bytes, SHA256
c390cf1908007dc0ab9f1c6914384532c8482cbd6fbe5aea2752e610425e09ae.
The static library is 8,966,240 bytes. Both additive ABI exports exist and lipo
reports arm64. All 11 object members have inspected minimum macOS 11.0 commands.
Header SHA256:
e67e6aa2f9addbaa73591ce6a049d34f2d352ea4600cc66a00af5181a8d6f8f6.
Source manifest SHA256:
fc1935ea9bd3941c8712437136c2fd31abcd566b47626e1bba71286d7396e0ab.

Local artifact and logs:
.terax/pi-development/native-core-consumer/producer-20261115-01.
The surrounding SSH postprocessing shell returned 1 after attempting to assign
zsh's read-only status variable. The producer had already completed its gates
and printed the final archive hash; this shell error is preserved in the journal.

## Prebuilt consumer and licenses

The explicit route is:
node scripts/with-zig.mjs --variant native-core-v1 --archive PATH -- COMMAND.

The checked-in consumer receipt pins archive, source manifest, terminal header,
both ABI capabilities and target identity. The wrapper verifies the package and
exact cache before running a command in the existing no-Zig prebuilt environment.
It uses a separate cache namespace. Canonical and provisional pins remain intact.

Both Cargo roots patch the same safe libghostty-vt 0.2.2 source, checked against
crate SHA256 16c7287a8dc35c3436224b39358af81ab9ea54bafa0f7ea2e068bd2a47bdcb2d
and upstream libghostty-rs c9876b2902d5bb3e1f3d61b6395059f1e5e7b721.
Two mutable methods use the existing handle/result conversion and new sys
bindings. There are no pointer layout casts or invented option values.
The MIT option and pinned repository notice are preserved in each vendor.
The native archive carries the original Ghostty/dependency notices and source
patch; Apple SDK files are not redistributed in it or committed.

The manifest's preparation status is historical source provenance, preserved
byte-for-byte after production. Current measured acceptance is recorded here,
in consumer.json and in the artifact build.json.

## Validation and review

- Node wrapper/policy/license/variant checks: 39 passed.
- Combined focal native pass: 93/93, zero skips, including all 23 authored cases.
- Complete core pass: 4925/4959 passed, 34 upstream skips.
- ReleaseFast, both exports, arm64 and all object minimum-target gates passed.
- Rust actor: 2 passed, covering ordinary and blocks, real startup cap, live
  trim, selection retention, old frame rejection, applied receipts and no-op.
- Applied state: 3 passed. Feature-off row validation: 1 passed.
- Matching prebuilt smoke create/feed/render passed.
- App native library clippy with warnings denied passed.
- Astra reviewed combined source/target, backend, safe wrapper and receipt
  activation without remaining blockers.

The smoke without optional Kitty features emits three upstream unused-code
warnings from the newly local safe crate. They are not ignored app clippy errors.
No full Rust sweep or new performance benchmark was run for this closing block.

## Limits and handoff

This local archive supports arm64 macOS only. Its object minimum macOS 11.0
is compatible with the app minimum macOS 13.0, already present at baseline
0c573d8. Object deployment gates do not prove runtime on the supported minimum;
macOS 11 is not a required app target. Intel, Linux and Windows need matching
extended artifacts before enabling this backend there. Stable row retention is
exact, but it is not a byte ceiling or a reflow peak-memory promise.

This block does not claim physical Cmd+K, screenshot or frontend capture acceptance.
The root integrates the parallel frontend into qa and validates the assembled app.
No Actions, push, PR, publication or merge was performed by this lane.
