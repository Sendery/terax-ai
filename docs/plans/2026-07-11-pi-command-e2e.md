# Pi command registry E2E

## Objective

Verify every active Pi-facing Terax command through the real Pi extension, authenticated loopback bridge, React registry, and native Windows UI. Each visible transition is evaluated with redacted structural snapshots and native screenshots captured before and after.

## Fixture

Use an isolated Windows fixture repository outside the Terax source tree containing:

- `alpha.txt` with stable non-sensitive text.
- `diff.txt` committed as `before` and then changed to `after`.

Launch the current Windows Terax development build with this fixture as the launch directory. Evidence is written under this Terax repository's ignored `.terax/visual-qa/e2e-*` paths.

## Matrix

1. `app.snapshot`
   - Call via `terax_get_state` and via `terax_call`.
   - Assert protocol version, active tab/space, sidebar and redacted tabs.
2. `sidebar.hide`
   - Capture main before, call, wait, snapshot, capture after.
   - Assert `sidebar.visible=false` and visible collapse.
3. `sidebar.show` explorer
   - Capture before and after.
   - Assert visible explorer view.
4. `sidebar.show` source-control
   - Capture before and after.
   - Assert visible source-control view.
5. `tab.openFile`
   - Open fixture `alpha.txt` pinned.
   - Assert a pinned editor tab exists and becomes active; verify editor visually.
6. `tab.rename`
   - Rename the editor tab to `PI E2E Renamed`.
   - Assert snapshot and tab strip title.
7. `tab.resetTitle`
   - Reset that tab title.
   - Assert original title returns structurally and visually.
8. `tab.focus`
   - Focus the initial terminal, then the editor.
   - Assert `activeTabId` transitions and visible content changes.
9. `git.diff.open`
   - Open the modified fixture file in `+` mode.
   - Assert an active `git-diff` tab with the expected root/path/mode and visible diff.
10. `tab.close`
    - Close the git diff and editor tabs by ID.
    - Assert each disappears and active fallback remains valid.
11. `settings.open`
    - Open the shortcuts settings tab.
    - Capture the settings surface and assert the Shortcuts section is visible.
12. Negative boundary
    - Attempt one non-allowlisted command and one invalid payload.
    - Assert rejection and no state transition.

## Development workflow

Run Pi in the real Terax repository with only read-oriented built-ins plus the local package. Ask it to:

- call `terax_development_guide` for `feature`, `window`, `setting`, `shortcut`, and `command`;
- read `AGENTS.md` and `TERAX.md`;
- inspect one listed contribution point per capability;
- return a machine-readable report without changing files.

This verifies source access and guidance. It does not claim that arbitrary new production code is correct without implementing and testing a concrete future feature.

## Pass criteria

- Every command traverses Pi tool -> extension -> authenticated TCP -> Rust -> Tauri event -> React registry.
- The command result and following redacted snapshot match the acceptance criteria.
- Before/after images contain only the authenticated Terax surface and visually match the expected transition.
- No command requires raw UI clicking for control.
- Development guides are usable from Pi and point to existing source paths.
- Any discovered defect is fixed and the affected scenario rerun before the final report.
