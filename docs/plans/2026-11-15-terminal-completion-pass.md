# Native terminal completion pass

## User-directed execution order

The user requested this order on 2026-11-15:

1. Finish the current focused checks, commit the validated blocks as Sendery,
   and consolidate them in local qa on M2.
2. From that recorded base, one Astra agent with high reasoning implements
   all remaining terminal capabilities in a single coherent pass.
3. During implementation use lightweight logical checks and focused invariant
   tests. Defer the broad suite, app build and general functional sweep until
   the implementation is complete. Do not interrupt each feature for another
   full validation floor or reviewer cycle.
4. Run the general sweep once against the complete candidate, then return to
   atomic validation. Correct concrete failures in isolated atomic worktrees.

This changes the development cadence, not the functional completion condition.
The active objective remains a usable Terax with the new terminal and the same
capabilities or better. The 60 FPS target is optional. No further performance
laboratories are requested.

## Source of scope

Read TERAX.md, docs/architecture/terminal-engine.md, the original
2026-11-10 terminal plan, the 2026-11-14 parity inventory and the latest
2026-11-15 integration report. Audit the actual native and legacy consumers.
Historical paragraphs in the parity inventory describe earlier checkpoints;
a listed gap may already be implemented. Reuse working native capabilities
instead of creating duplicate adapters or treating missing acceptance as
missing code.

Cover ordinary tabs and splits, lifecycle/failure, hidden busy panes, negotiated
keys and multiline input, IME/dead keys, paste/clipboard, focus/mouse/selection,
scrollback/reflow, all existing terminal preferences, rendering recovery,
search/links/file drops, shell state, blocks/drafts/actions, selection actions,
AI/agent context, restore, scheduled delivery, Pi/control/privacy and captures.
Implement applicable original improvements, including the notification/progress
protocols and remaining Kitty/grapheme integration. Retain an explicit
source-grounded decision for conditional ligatures.

Preserve existing security boundaries, private exclusions, owner checks and
bounded resources. Use the shared session facade for all app consumers.
Do not add arbitrary public terminal input, buffer or evaluation endpoints.
Do not replace unavailable data with fabricated success. Bash authoritative
full-command capture was already absent in the legacy baseline; do not invent
a history/timing heuristic to label it complete.

Prepare rollout coherently with the completed implementation. Keep fallback
and the sandbox identity until the general functional sweep and applicable
rollout requirements are met. Do not delete a legacy feature to make parity
appear complete. Other-platform runtime and real-workload acceptance cannot
be inferred from M2 source checks.

## Environment and ownership

All project operations run on M2 over ssh arb@10.0.0.20. Do not read, edit,
reset, compile or run the protected original Mac project. Source the M2
~/.config/terax/dev-env.sh for Node24 and pnpm11.5.0.

Use a dedicated completion worktree from the frozen qa base. The implementation
agent owns it exclusively and does not spawn further agents. Root coordinates
integration and the later general sweep.

Every Cargo command uses the explicit shared target directory
/Users/andres.rojo/Workspaces/terax-ai/src-tauri/target and a root-issued native
compile lease. Consumers use the exact verified prebuilt variant, without Zig
fallback. Explicit producer maintenance is allowed only on M2 with the pinned
toolchain and a real SDK. Keep archive, headers, safe/sys wrappers, extension
manifest and capabilities coherent.

No GitHub Actions, push, PR, publication or release. Commits use the existing
Sendery includeIf identity without overrides. Integrate additively; preserve
existing branch history and unrelated files, panes and editors.

The running old sandbox is a separate frozen artifact. Do not kill it or
replace it during the implementation pass. In particular preserve unrelated
editor38. Live UI belongs to root for the later sweep.

## Implementation handoff

Deliver the completed code, local commit hashes, exact lightweight checks and
a concise source-based inventory: implemented, already present, and remaining
acceptance. Record any real external prerequisite rather than declaring it
implemented. The later sweep owns full frontend and Rust gates, one matching
sandbox build, privacy/failure scenarios and real app interactions. Do not
claim the overall goal complete from the implementation pass alone.

