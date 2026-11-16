# QA publication and paused validation: 2026-11-16

The user authorized publishing the current qa branch and the existing tested DMG to GitHub, then pausing development and validation for two days, until 2026-11-18. Functional parity remains open. This checkpoint adds no product code and does not rerun suites.

## Published candidate

- Runtime source: ace585793c73a8ee52fa12f622c3a554921eba37.
- Product: Pi-Terax Sandbox, native Ghostty engine enabled.
- DMG: Pi-Terax-QA-0.8.0-ace5857-arm64-dev.dmg.
- SHA-256: 9df1ed2068c075d4040651fd307a62bb27bb05682f4453e51b6e88f04f2ccc97.
- macOS ARM64, macOS 13 or later, development/debug profile, ad-hoc signature, no notarization.
- The qa branch includes later documentation commits; those do not change the packaged runtime.
- Existing hdiutil, mounted signature and executable identity checks passed. This is a QA prerelease, not a production rollout.
- No Actions build is needed: upload the already validated M2 artifact.

## Minimum next validation pass

1. Finish the grouped presentation check: background settings and cell contrast, actual Redraw, and inactive capture containing Blocks, Unicode and an inline image. The latest own fixture only flushed its finite output and produced a baseline pane capture. Neither visual acceptance nor background/Redraw acceptance is claimed. No background or renderer preference changed; the owned tab and idle shell were closed and all original 13 tab metadata restored before pausing.
2. Check ordinary split ownership during bounded concurrent work: activity, attention, completion/error and input must affect the correct leaf. Combine manual Redraw across ordinary panes where useful. Blocks retain the baseline single-pane restriction.
3. Reconcile each original capability against the parity inventory and accumulated evidence. Preserve scoped earlier passes rather than repeating broad suites. Separate an untested scenario from missing implementation or a confirmed defect.

## Residual scope to report during that audit

- Presentation: actual context loss or display wake, complex-text search, image cropping/history, physical mixed-DPI behavior and remaining theme/hover combinations have no blanket runtime acceptance.
- Consumers: Ask Terax opens with an installed Codex CLI and no SDK key, preserving the selected terminal chip. Block normal/empty attachments and exact logical serialization passed. Live SDK context delivery and audible TTS were not established because the required configured provider/voice resources were absent. Do not add dummy keys or imply a model received context.
- Agents: Codex detection, once-only manual task delivery and Always restart/context restoration passed. Remaining split activity, scheduled delivery/retry, unchanged or unavailable buffers and owner changes need scoped reconciliation. Authenticated Claude is not covered by the Codex result.
- Notifications: the bell and pane-owned progress have evidence; OS banner title/body and remaining error/paused/stale/private cases are not all proven.
- Platforms and shells: M2/macOS ARM64 and the separate M4 prebuilt A-E consumer test have evidence. Intel/macOS, Linux, Windows, Fish/PowerShell/WSL and matching extended-core artifacts are not established by those Mac ARM64 checks.
- Release rollout: this artifact is a debug QA Sandbox. Production-default activation, optimized/distribution signing/notarization and platform releases are separate work.

The detailed chronological record remains [terminal acceptance status](2026-11-16-terminal-acceptance-status.md), with the [parity inventory](2026-11-14-terminal-parity.md) and [implementation inventory](2026-11-15-terminal-complete-implementation.md). Earlier table rows may be superseded by later acceptance sections in that record.

## Deferred by the user

The optional 60 FPS target comes before Japanese composition/IME in the backlog. Neither blocks functional migration or publication of this QA prerelease.

## Pause handoff

No further development or validation should run during the two-day pause unless the user explicitly resumes it. No automatic resume job is configured. The current Sandbox was left with its original workspace; its owned keep-awake process was stopped. Test captures and receipts remain ignored on M2. No credentials, private terminal content or full-window screenshots belong in release assets.
