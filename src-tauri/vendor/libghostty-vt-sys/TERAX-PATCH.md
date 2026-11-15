# Terax prebuilt policy

This is libghostty-vt-sys 0.2.2 from crates.io, upstream
Uzaaft/libghostty-rs commit c9876b2902d5bb3e1f3d61b6395059f1e5e7b721,
directory crates/libghostty-vt-sys. The original library and generator are unchanged. The bindings additionally
declare the two reviewed Terax native-core-v1 exports, which require the matching
prebuilt variant; they are not provided by the original archive. Terax redistributes this copy under the MIT option, with the
upstream commit's license in LICENSE-MIT.

The only Rust change is in build.rs: source compilation requires the exact
TERAX_GHOSTTY_SOURCE_BUILD=1 opt-in before reading build directories, cloning
Ghostty or executing Zig. Cargo tracks changes to that variable. Without it,
pkg-config failure is an error even for a Cargo invocation outside the wrapper.
The explicit scripts/with-zig.mjs --source route supplies the opt-in; prebuilt
mode rejects it. The PATH guard remains a second barrier.

Both workspace roots, src-tauri and scripts/libghostty/smoke, patch crates.io
to this same directory. When upgrading, update both lockfiles and verify this
policy before running any native build. Do not replace this crate with the
registry version and assume the wrapper's PATH guard disables source fetches.
