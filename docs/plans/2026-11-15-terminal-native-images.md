# Native inline terminal images

Direct Kitty RGB, RGBA and PNG images now reach the normal native terminal
through libghostty-vt placements, the binary frame codec and the shared window
WebGL2 context. This is a functional migration block, without an FPS gate.
The production default stays unchanged while remaining parity is open.

## Behavior and ownership

The core owns decoding, source crops, placement geometry, screen/scroll history
and content generations. Full frames carry every visible pixel payload; partial
frames carry current placements and only new/replaced generations. Same-size
image replacement cannot reuse an old texture. The TypeScript decoder validates
all counts, bounds, formats, source rectangles and full-frame references while
preserving 64-bit generation identities. No image filesystem path reaches JS.

Images use the existing one-canvas, one-context window renderer. Three z layers
respect non-default cell backgrounds, text, alpha and pane scissoring. Default
text-only panes retain the existing single draw. Texture creation and shaders
are validated in the guarded frame apply path so errors do not strand display
credits. Image-cache capacity uses the same bounded visible recovery as glyphs.

CPU pixels have independent bounded ownership; retained metadata excludes
upload views into incoming frame buffers. Hidden panes release image caches and
request full reconstruction when revealed. Context loss defers glyph/image work
and a recovered full frame rebuilds images. Native cell metrics follow device
pixels independently of grid changes, including measurements made during open.
Coalesced native updates preserve admission order.

The packet layout and exact limits are in docs/architecture/terminal-engine.md.
Direct placements are this block's scope. Kitty virtual Unicode placeholders,
Sixel/iTerm images, terminal-driven animation and physical mixed-display
acceptance are still open. This is not a claim of complete Kitty protocol
support or completion of the overall terminal replacement.

## Native policy across resets

Storage is limited to16MiB per initialized screen, PNG decode/frame uploads
to32MiB, dimensions to8192, visible placements to4096 and window CPU image pixels
to128MiB, with corresponding GPU textures. File, temporary-file and shared-memory
media are disabled. Existing dependencies and the pinned prebuilt are reused;
there is no Zig/source fallback.

Tests exposed that initializing/resetting a screen restores the pinned core's
default320000000-byte quota. The shared ordinary/blocks feed enforces policy
before/after input and conservatively after possible APC introducer-final bytes.
This covers C0/DEL interleaving without adding a second VT parser or changing
bytes. A native reply callback queries the quota during image processing,
before end-of-feed restoration; all five accepted ESC variants and all fragment
boundaries observe16MiB. Raw C1 variants ignored by this pinned UTF8 core preserve
its exact text/image behavior. The impact found was quota restoration, not a
reopening of file media. A real PNG callback with X-containing base64 and
seven-byte chunks proves conservative feed splits preserve pixels.

## Source verification

M2 isolated worktree /Users/andres.rojo/Workspaces/terax-worktrees/native-images,
branch feat/native-terminal-images, base4acf668. Main M2 checkout and protected
Mac checkout were not changed by this block. Sendery local commits only:
no Actions, push, PR, merge or publication.

- GL module:254 passed and one existing fixture-absence skip.
- Native engine:186 passed and one existing ignored.
- Strict clippy passed with and without ghostty-engine.
- Type checking and frontend/Pi build passed.
- Full lint:121 diagnostics, exact baseline119warnings and2infos.
- Real Rust-generated RGBA frame decodes in TypeScript; the fixture normalizes
  only process-global generation values for deterministic comparison.
- PNG alpha/RGB/gray conversion, malformed/oversized input, native replacement,
  alternate-screen restoration/deletion and policy across resets are covered.
- Independent Astra source review closed shader initialization, buffer retention,
  lost-context work, opening metrics, coalescing order and quota-window findings.
  Real native WebKit acceptance is recorded after building this checkpoint.

Exact checks:
```sh
pnpm exec vitest run src/modules/terminal/gl
pnpm check-types
pnpm build
pnpm exec biome lint ./src --reporter=json --max-diagnostics=none
.terax/pi-development/m2/with-ghostty cargo test --manifest-path src-tauri/Cargo.toml --target-dir /Users/andres.rojo/Workspaces/terax-ai/src-tauri/target --locked --features ghostty-engine --lib modules::pty::engine
.terax/pi-development/m2/with-ghostty cargo clippy --manifest-path src-tauri/Cargo.toml --target-dir /Users/andres.rojo/Workspaces/terax-ai/src-tauri/target --all-targets --locked --features ghostty-engine -- -D warnings
cargo clippy --manifest-path src-tauri/Cargo.toml --target-dir /Users/andres.rojo/Workspaces/terax-ai/src-tauri/target --all-targets --locked -- -D warnings
git diff --check
```
Only the direct-rgba fixture was generated with UPDATE_FIXTURES=1. Final engine
checks run without regeneration. Native commands are sequential with the explicit
shared target and the checksum-verified provisional0.2.2 archive pinned in the
engine contract. Full repository tests, platform matrices and benchmark labs
are not claimed for this block.

## Focused real WebKit acceptance

Standalone sandbox production commit88516c1 was built with embedded frontend
and the native feature, copied independently of the Cargo target and exercised
through authenticated buildInfo/app.snapshot/app.capture. A deterministic public
PNG/RGB/RGBA fixture ran in real zsh PTYs through an isolated ZDOTDIR profile,
without editing the user's profiles. The active ordinary tab contained two
split native panes sharing one renderer.

The inspected1068x1024 PNG shows, in both panes:

- Four PNG color quadrants above underlying text.
- A direct RGB red/blue image.
- A half-transparent green RGBA image below readable white text.
- A below-background purple image covered by an explicit ANSI red background.
- Independent pane clipping and the intact split divider.

This proves focused pixels and layering on M2 WebKit, not complete image
protocol acceptance. Cropped-edge filtering, every theme, virtual placeholders,
image reflow/scroll interactions and physical mixed-DPI remain to verify or
complete before full replacement is claimed.

The initial direct-launch automation could inspect state but capture timed out.
Opening the exact frozen bundle through LaunchServices preceded successful
capture. Earlier keyboard automation failed before its ready acknowledgement;
the isolated shell startup fixture supplied actual PTY output instead. A one-off
shell also sourced that profile, so its bounded waiting period was released.
The fixture was then finished, the candidate closed only after checking unchanged
public/clean tabs and idle children, and the same88516c1 bundle relaunched with
the normal inherited environment. Its authenticated build and original active
tab35 were verified after restoration. No watcher or custom profile remains
attached to the running candidate.

Evidence:
.terax/visual-qa/20261115T143125.342Z-native-inline-images-startup-JbKYvi/screenshot.png
and the matching result.json. Exact capture provenance is retained privately in
.terax/pi-development/m2/image-qa-result.json. Temporary PIDs and startup scripts
stay in the ignored journal. No protected Mac project execution, Actions,
repository publication or FPS experiment was used.

## Crop, theme identity and viewport follow-up

The image sampler now clamps bilinear lookup to source texel centers. Magnifying
a one-pixel crop cannot sample adjacent pixels outside the requested rectangle.
Grid background identity is carried as exact RGB integers through the shader;
below-background images no longer depend on equality between independently
rounded floats. Cursor block handling remains explicit.

A real empty-intersection test failed against88516c1: the core can retain a
placement with no drawable area, which the producer serialized into a packet the
strict client rejects. The producer now omits zero source/pixel areas before
counting placements or retaining image generations, so valid empty crops do not
cause invalid-frame retries. Core tests also verify native crop/position through
scroll, changed cell metrics, complete exit from the viewport, history reentry
and full-frame reconstruction.

Focused final source checks:256 GL tests passed plus the existing skip;188 native
engine tests passed plus the existing ignored; types, frontend/Pi build, native
strict clippy and diff checks passed. Lint remains the exact121-diagnostic
baseline. Astra source review found no remaining blocker in this delta.
New uniform assertions establish the GPU contract, not actual WebKit pixels;
the new frozen candidate's visual acceptance is recorded separately.

Commands are the same scoped GL/types/build/lint and explicit-target native
engine/clippy commands above. No performance experiment or platform claim was
added, and the live88516c1 app stayed independent while this source changed.
