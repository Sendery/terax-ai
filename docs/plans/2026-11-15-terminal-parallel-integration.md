# Parallel native terminal integration

## Current unified qa checkpoint

The validated parallel blocks are consolidated additively in local qa on M2,
at /Users/andres.rojo/Workspaces/terax-worktrees/qa. The code checkpoint is
8634b185370521e1c1b156110751632ee88540dc. qa preserves origin/qa history;
the existing branch was an ancestor and was advanced without a merge commit.
All new commits use Sendery.

| Block | Original checkpoint | Integrated checkpoint |
| --- | --- | --- |
| Native Canvas2D/GPU fallback | 4c0e839 | 4c0e839 |
| Physical-coordinate file drops | 6f541cf | 7c4a5d0 |
| Owner-bound agent restoration | 349b2c5 | ef3af8b |
| Image-background foreground contrast | 72d8fdf | 46059a5 |
| Live cursor preference and header-only frames | 029e9b8, 4dba9aa | 97d40a8, 3eb87f3 |
| Owner-bound scheduled task handoff | 6473e8b | a27ea8f |
| Focused native Clear Active, Mod+; | 76dd863 | cea3fa6 |
| Bash compatibility evidence, no production change | 4a1e8d3 | ab5f336 |
| Inactive native pane capture | e157cfb | 5acaa79 |
| Capture acceptance and GPU preference evidence | 4bb5a19 | 4bb5a19 |
| Exact-row retention core and producer | 304bd73, fc853bc | 248fdcc |
| Cursor-row-preserving host clear core | 690ae3d, 12ca866 | 95fa5ed |
| Combined archive, safe/sys wrappers and Rust consumer | 1c840f0 | c2baf5e |
| Live history preference and Cmd+K frontend | fbc7973 | 8634b18 |

No Actions, push, pull request, publication or protected-original-Mac project
operation was performed. Native work and source operations stayed on M2.
This is a validated source checkpoint, not a new complete runtime acceptance.

## Current block checks

The final assembled qa code passed these lightweight checks on M2:

- pnpm exec vitest run src/modules/terminal/gl/engineSession.test.ts src/modules/terminal/gl/nativeLeafSession.test.ts src/modules/terminal/gl/nativeState.test.ts src/modules/terminal/lib/sessionSubmissionFacade.test.ts: 173 passed, four files.
- pnpm check-types: passed.
- git diff --check for the final source block: passed.

The individual native-consumer block passed 39 Node tests, two real actor
tests, three state tests, one feature-disabled range test, create/feed/render
smoke and strict library Clippy. Astra reviewed backend, safe/sys wrappers,
activation and receipts without a remaining source blocker.

The frontend block passed its focused lint checks with baseline warnings.
Astra found a rejected-admission deadlock in the row-setting queue; root
reviewed the directed correction and two failing-then-passing regressions.
A rejected command releases only its own attempt, never fabricates application,
never retries on unrelated state publication, and permits a later explicit
preference change.

These are block checks, not a claim that the whole repository was retested.
The previous a27ea8f integration passed 691 tests plus one existing skip,
types, unchanged lint baseline (119 warnings and two infos), and sandbox build.
The later 5acaa79 capture integration passed 423 tests plus one existing skip
across 39 files, types, the same lint baseline, and sandbox build. The final
combined qa code has not yet been built or exercised graphically.

## Native core and official SDK resolution

The earlier SDK build-runner failure was resolved using verified official Apple
CLT16.2 payloads and the real compatible SDK15.2 in an isolated Developer
directory on M2. Package signatures, catalog compressed-XAR-TOC checksums,
payload provenance and archive hashes were checked. No installer script, SDK
shim, xcrun replacement, global xcode-select change or source-pin substitution
was used. The protected original Mac was not involved.

The combined source variant pins Ghostty
a887df42c56f6de86c0fe6da9c4eeca37931e083 and wrapper0.2.2. Its patch SHA256 is
46735899626426a334b9c96a5faaed58da3391cd8103c24879fa2e95ff30ad4a.
It exports exact physical-row retention and host clear preserving the complete
active cursor row, pen, modes, pending wrap and inactive screen isolation.

The explicit producer completed 93/93 focused tests with zero skips and
4925/4959 full tests, with 34 documented upstream skips, then ReleaseFast.
The archive SHA256 is
c390cf1908007dc0ab9f1c6914384532c8482cbd6fbe5aea2752e610425e09ae
(2827833 bytes). Both required exports and arm64 architecture were verified;
all eleven archive objects declare macOS11.0, matching the intended arm64
deployment minimum. Actual execution on macOS11 is not claimed.

The checksum-pinned local archive lives in the native-core-consumer ignored
producer output. The explicit native-core-v1 consumer verifies archive,
extension manifest, headers and capabilities and uses matching vendored safe
and sys wrappers. It never falls back to Zig source. The original canonical
published pins remain unchanged. Matching Intel/Linux/Windows variant archives,
publication and native runtime acceptance on those platforms remain open.

See the native-core-consumer, native-history and native-host-clear reports.
The root independently checked the final archive hash and verification summary.
Native producer and Cargo use were serialized; the shared target directory is
/Users/andres.rojo/Workspaces/terax-ai/src-tauri/target.

## History settings and clear semantics

Ordinary native sessions now use the existing row preference at startup, live,
while hidden and after respawn, with integer bounds200..50000 and default2000.
The actor coalesces row targets and publishes applied host mutation receipts.
Admission acknowledgements are not treated as application. The frontend
retains one in-flight target and the latest desired value and rejects stale
history projections, links, searches, reads and captures across mutations.
Retained core selection is reread after clipping rather than restored from
obsolete cached text.

Cmd+K uses a host clear with actual focused input and owner guards and no PTY
write. A real core no-op stays a no-op. Mod+; retains its independent formfeed
behavior. Manual private input remains allowed; private read/capture exclusions
remain enforced. Physical shortcut, preference and retained-selection scenarios
for the newly assembled code belong to the later general sweep.

## Last exact running sandbox and graphical evidence

The currently frozen running app remains the earlier 5acaa79 normal-environment
sandbox, PID98257, verified through discovery, app.buildInfo and mapped
executable. It does not contain the new combined archive/frontend. No temporary
ZDOTDIR override or user profile edit is active.

M2 was observed unlocked and on-console with Accessibility trusted and the
exact own app foreground. Normal public active35 and inactive9 pane captures
produced 1964x1564 PNGs, visually inspected for readable text, colors, cursor
and divider. Active tab35, all twelve tabs and idle shell PIDs72609/98422/98423
were unchanged. The unrelated clean editor38 was preserved and not read.

The real Settings Use WebGL renderer checkbox completed on/off/on, restoring
its original enabled value, with the two original shell identities and tab/pane
counts unchanged. This proves actual preference control and process retention;
software pixels/input echo and context-loss recovery remain unaccepted.
Earlier capture deadlines occurred while locked, but that condition is not
asserted as the sole cause.

The running app must not be blindly closed or replaced: editor38 and the
current three-shell/tab state differ from older strict close helpers. Preserve
that unrelated state during the later exact-candidate handoff.

## Next implementation and validation cadence

Follow the user's [completion-pass instructions](2026-11-15-terminal-completion-pass.md):
one Astra agent with high reasoning implements all remaining functionality
from this qa base in one isolated worktree. Use lightweight logical checks and
focused invariants during that pass, without broad repeated floors or more
performance labs. After implementation, run one general sweep against the
complete candidate, then correct failures through atomic worktrees and return
to atomic validation.

Audit actual source against the full parity inventory. Historical paragraphs
record earlier gaps and do not mean working native features should be rebuilt.
Input/TUI/mouse, settings, graphics, notifications, app consumers, agents/tasks/
restore, captures, privacy/failure, platform compatibility and rollout all
remain within the objective. Missing scenario acceptance must be recorded
separately from missing implementation.

The active goal remains a usable normal Terax with the new terminal and the
same capabilities or better. Default rollout, applicable real-workload and
platform acceptance remain open. 60 FPS is optional and deferred.

