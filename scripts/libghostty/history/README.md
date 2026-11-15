# Exact physical history rows, prepared source extension

Status: source and explicit M2 producer validated. The upstream baseline passes
53 tests; the row-retention focal gate passes 74; the complete native suite passes
4906 with 34 skipped. The generated arm64 archive has minimum macOS 13.0.
This is an experimental M2 variant, not a universal release or proof of the
application's macOS 10.15/arm64 11 deployment compatibility. The current consumer
pin, Cargo graph and application row preference remain unchanged.

## Contents and license provenance

- core.patch: seven Ghostty files based on the exact upstream commit in
  manifest.json. The manifest records upstream Git blob IDs and before/after
  SHA-256 hashes. The extension uses the upstream MIT license, already
  preserved as scripts/libghostty/licenses/Ghostty-LICENSE.
- rust-wrapper.patch: pending safe method inside libghostty-vt 0.2.2.
  It was generated from the original registry archive, verified against
  Cargo.lock checksum 16c7287a8dc35c3436224b39358af81ab9ea54bafa0f7ea2e068bd2a47bdcb2d.
  That crate declares MIT OR Apache-2.0. This patch does not vendor or activate it.
- rust-sys.patch: pending additive declaration against the existing vendored
  0.2.2 bindings, also recorded by before/after hashes.
- apple-clt16.2.json: public Apple package provenance and SDK fingerprints.
  No SDK files, installers or credentials are checked in or packaged.
- variant.mjs: strict source/patch/SDK identity checks and a distinct artifact name.
- produce.mjs: explicit arm64 macOS producer. It never runs from with-zig.mjs,
  Cargo build.rs, or a normal app build.

## Functional policy

The setter changes the primary screen, including while alternate is active.
History means physical rows outside the active area. A larger limit stores a
scalar without allocating future rows. A lower limit removes the exact oldest
prefix, physically freeing complete pages. The boundary page keeps its capacity.
Zero also uses eviction-aware row growth, so removed refs cannot alias new rows.

The installed row policy replaces the byte budget. It is enforced after stable
Screen growth, scroll-clear, resize and clone bookkeeping. Reset preserves it.
A Screen without a row policy retains upstream behavior. The alternate screen
has no row policy and retains its existing no-history behavior.

Retained tracked pins keep their contents; removed pins become garbage. Untracked C grid references are short borrows valid only until a mutation;
callers must obtain fresh snapshots from surviving tracked refs before reading.
Internal serial-aware page tokens still use the existing generation machinery. Crossing
selections clip with direction/rectangle semantics; wholly removed selections
clear. The viewport follows surviving content or clamps. Removed image anchors
remove their placements without destroying unrelated images or virtual placements.

Resize still uses upstream reflow and its allocator. Final retention is exact,
but this extension does not claim constant peak memory during reflow. In
particular, narrowing a wide history can transiently increase physical rows
before the stable Screen trim. No estimated bytes-per-row conversion or large
preallocation is used. Review/test allocator-failure paths before shipping.

## Review, then explicit M2 producer

Do not run these steps on the protected original Mac. Every new native run requires the coordinating agent's exclusive compiler lease.

1. Review core.patch, manifest.json and the producer. Run the nine Node
   policy tests and apply-check against an untouched exact source checkout.
2. Use a dedicated full public Ghostty checkout at the manifest commit. Do not
   use a partial research cache as a build tree. Keep all producer output outside
   it, using a new leaf directory beneath an existing parent. Real source/output
   parent paths are compared so symlinks cannot redirect output into source. No credentials or writes to an upstream repository are needed.
3. From this project worktree, on M2 with the real installed SDK, invoke:

       DEVELOPER_DIR=/absolute/path/to/verified/CommandLineTools \
       TERAX_GHOSTTY_SDK_PROVENANCE=/absolute/path/to/producer-toolchain.json \
       TERAX_EXPLICIT_SOURCE_PRODUCER=1 node scripts/libghostty/history/produce.mjs \
         --source /absolute/path/to/clean-ghostty-checkout \
         --output /absolute/path/to/new-output-directory

   The verified profile has schema 1, selected developerDir/sdkPath/sdkVersion
   and SHA256 fingerprints for SDKSettings.json/libSystem.tbd, plus metadata
   recording the four signed Apple package URLs, versions, sizes and hashes.
   It is process-local input, not a consumer fallback. The producer verifies
   xcrun's actual selection against that profile before changing source.

   CLT 16.2 is materialized from unmodified signed Apple payloads in an isolated
   tree. Its SDK aliases come from Apple's SDK-wrapper payload. No package
   scripts, global installer or xcode-select changes are used. SDKROOT alone
   does not select Zig's host-runner SDK; its xcrun --sdk macosx call respects
   the real DEVELOPER_DIR. One shared process environment prioritizes
   /usr/bin:/bin for preflight, provisioning helpers and every Zig invocation,
   so compiler SDK discovery cannot resolve a different xcrun from PATH.
   The pinned binary disables --debug-libc, so do not
   use that unavailable route or an xcrun shim.

   The producer checks the base/clean tree, license bundle and patch, applies
   only that patch, verifies resulting source hashes, provisions the existing
   checksum-pinned Zig 0.15.2, runs focused and complete lib-vt Debug tests,
   builds ReleaseFast with two jobs and checks the new exported native symbol. The test summary must
   prove at least eleven passing tests; zero matches cannot package an artifact.
   It packages headers, notices, patches, manifest and explicit build metadata.
   A failure stops packaging. Do not substitute SDKs, xcrun shims or another
   compiler if the real SDK is rejected; report the actual error.
4. Record the actual tarball SHA-256 and native gate outputs. Do not overwrite
   an existing artifact or label the patched binary as unmodified upstream.
5. Only after native tests, link/runtime checks and independent review, add a
   separately pinned consumer variant accepting this capability and exact
   manifest/patch identity. Preserve checksum enforcement and deny Zig/source
   fallback in normal app builds. Apply the pending Rust patches into reviewed
   vendored crates and wire the existing row preference at startup/live/respawn.
   No unsafe opaque-handle casts and no unknown option probing are needed.

The producer changes its dedicated source checkout and does not revert it.
After a failed run, diagnose that tree; do not silently reset it or retry using
a dirty checkout. The output directory is intentionally never reused.

## Verification status

- Root/Astra source review passed, including the raw-borrow correction.
- Node policy suite:9 passed. Producer syntax check passed.
- Untouched upstream baseline with official CLT 16.2/SDK 15.2:53 passed.
- Row-retention focal native gate:74 passed.
- Complete lib-vt native suite:4906 passed,34 skipped.
- ReleaseFast native library built, new exported symbol found,11 Mach-O
  LC_BUILD_VERSION commands all report minimum macOS 13.0.
- Archive size 2798832 bytes; library 8885840 bytes.
- Archive SHA256:
  efa0706adf79151111af8a0605121126b02056310abe44dda9cd062a66ca97c6.
- No app consumer integration, Rust wrapper activation, UI acceptance or
  Intel/Linux/Windows validation is claimed by these producer gates.

The shared PATH guard was added after this experimental archive was produced.
Its measured binary and native test evidence are unchanged. A later combined
artifact will use the hardened recipe before consumer activation.

The eleven added behavior tests cover partial/full page cuts, actual retained
text, lazy increase, live changes, tracked-ref expiry/survival, fresh borrowed
snapshots preserving original contents, viewport behavior, selection direction
and rectangle columns, zero, reset, resize, scroll-clear, scroll-above, clone,
alternate-screen behavior and image placements. Full regression output is
recorded by the producer, including native skips.

Node command (does not compile or provision anything):

    node --test scripts/libghostty/history/variant.node-test.mjs

Native compiler commands are encoded in produce.mjs and require the parent lease.
Rust consumer gates and real application acceptance are a later integration
phase with the newly verified artifact, not evidence supplied by these sources.
