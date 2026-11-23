# Combined native terminal core variant

This explicit producer composes the reviewed exact-history and host-clear sources on
Ghostty a887df42c56f6de86c0fe6da9c4eeca37931e083 with Zig 0.15.2. Original source
bundles and measured artifacts remain unchanged. This variant is consumed only through its explicit local prebuilt route.

## Source scope

Nine upstream files are hashed before and after patch application. The 11 exact-row
cases and nine host-clear cases keep their reviewed bodies and receive a common
native core: filter prefix. Three additional cases exercise row policy after
clear, inactive primary policy while alternate is active, and zero-row policy.

Config preserves an explicit macOS minimum only when emitting lib-vt without exe,
macOS app, xcframework, or benchmark outputs. The generic CPU workaround and
ordinary upstream minimum of 13.0 remain intact. The producer explicitly requests
aarch64-macos.11.0, baseline CPU, and two jobs.

## Producer and compatibility gates

Run only on the explicitly authorized M2 producer with the previously verified
Apple CLT 16.2 and SDK 15.2 isolated directory. Select it by process-local
DEVELOPER_DIR; never change global xcode-select. The profile must match the
canonical SDK path, SDK settings and libSystem hashes. Every Zig call receives
the same system-tool-first PATH. No SDK payload is copied to the archive.

The producer requires a new output outside the clean pinned source checkout.
It verifies patch, source and dependency licenses before compilation, requires
the focused filter to execute at least 23 cases, then runs the full suite and
ReleaseFast. Both additive ABI exports must exist. Every ar -t member must
have an inspected macOS deployment load command at most 11.0, and lipo must
report arm64. A missing member or a 13.0 object fails packaging.

These are source/build gates, not evidence of runtime behavior on macOS 11.
Intel/macOS 10.15 remains a separate unverified target. Row retention guarantees
stable exact row counts, not a byte ceiling or peak-memory bound during reflow.
Raw C GridRef remains a borrow valid only until terminal mutation; tracked refs
must be re-snapshotted after mutation.

At preparation time all 23 native cases are written and unverified for this
combined patch. Node checks do not imply native execution. The prior measured
history-only archive remains macOS 13+ and is not substituted for this variant.

## Consumer integration

The app must always use an explicit matching prebuilt variant. Do not activate
Cargo patches, archive pins or runtime methods until the combined archive,
headers, manifest and minimum-target gates pass. No source fallback is added.

## First measured combined archive

Focal 93/93 without skips, full 4925/4959 with 34 skips, ReleaseFast, both exports,
arm64, and all 11 object minima 11.0 passed on M2. Archive SHA256
c390cf1908007dc0ab9f1c6914384532c8482cbd6fbe5aea2752e610425e09ae.
This does not establish runtime compatibility with macOS 11. The matching consumer receipt and safe Rust adapter passed focal integration
gates; see the own integration report for current scope and remaining UI checks.

## Additional targets

On the authorized Apple Silicon producer, run
`TERAX_EXPLICIT_SOURCE_PRODUCER=1 node scripts/libghostty/native-core/produce-cross.mjs <clean checkout> <new output directory> <target>`.
This verifies and patches a disposable checkout, then packages the static
library, headers, pkg-config metadata, the source manifest and license notices.
It verifies both patched symbols. The Intel archive also verifies all object
deployment versions. Cross compilation does not exercise the target runtime.
Linux archives use glibc 2.35. The MSVC target requires Windows SDK and MSVC
CRT headers, which are absent on the Apple Silicon producer.

The application consumes the measured Apple Silicon receipt in
`consumer.json` and additional target pins under `nativeCoreTargets` in
`scripts/libghostty/pin.json`. Both use the same patch, manifest and header
identities. The older unpatched producer pins are separate. For local builds,
name archives `libghostty-vt-0.2.2-a887df4-<target>.tar.gz` under
`TERAX_GHOSTTY_ARCHIVE_DIR`, or point `TERAX_GHOSTTY_ARCHIVE` to the host
archive. The public asset endpoint for these names is
`Sendery/terax-ai` under `terax-native-core-v1`, pending publication.


## Verified local consumer

Use --variant native-core-v1 --archive PATH through scripts/with-zig.mjs.
consumer.json pins the measured archive and matching metadata; default canonical
and provisional pins are unchanged. Both Cargo roots use the MIT-licensed safe
wrapper vendor with two mutable methods. The manifest preparation status remains
immutable source provenance; current build and integration gates are in the own
2026-11-15-terminal-native-core-consumer report. No consumer invokes Zig.
