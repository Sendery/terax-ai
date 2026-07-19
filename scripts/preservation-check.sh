#!/usr/bin/env bash
# Preservation battery for the updates/2026-07-18 upstream integration.
# Verifies that every Sendery-specific capability survives each cherry-pick.
# Usage: scripts/preservation-check.sh [--fast]   (--fast skips cargo test)
set -u
cd "$(dirname "$0")/.."
FAST=${1:-}
fail=0
note() { printf '%-58s %s\n' "$1" "$2"; }
check() { # check <label> <command...>
  local label=$1; shift
  if "$@" >/dev/null 2>&1; then note "$label" PASS; else note "$label" FAIL; fail=1; fi
}

echo "== Invariantes Sendery (estaticos) =="
for cmd in notes.show notes.hide notes.toggle notes.detach notes.attach notes.add notes.remove notes.update notes.list app.capture app.buildInfo app.commands tab.setColor; do
  check "registry: $cmd" grep -q "\"$cmd\"" src/modules/commands/lib/registry.ts
  check "pi allowlist: $cmd" grep -q "\"$cmd\"" src-tauri/src/modules/pi.rs
done
check "updater: endpoint Sendery" grep -q "Sendery/terax-ai" src-tauri/tauri.conf.json
check "updater: releases lib" test -f src/modules/updater/lib/releases.ts
check "updater: download command" grep -rq "download_release_asset" src-tauri/src/modules
check "releases: local release lib" test -f scripts/local-release-lib.mjs
check "releases: release-local" test -f scripts/release-local.mjs
check "capture: module" test -d src/modules/capture
check "capture: rust persist" grep -q "capture_persist" src-tauri/src/modules/capture.rs
check "pi-terax: package" test -f packages/pi-terax/package.json
check "pi-terax: visual native backend" test -f packages/pi-terax/src/visual-native.ts
check "agents: claude hooks installer" grep -rq "agent_enable_claude_hooks" src-tauri/src
check "agents: OSC detector" test -f src-tauri/src/modules/pty/agent_detect.rs
check "slot-monitor: module" test -d src/modules/slot-monitor
check "notes: module presente" sh -c 'ls src/modules | grep -qi notes'
check "pty: fish init script" test -f src-tauri/src/modules/pty/scripts/init.fish

echo "== Suites =="
if pnpm test >/tmp/pres-front.log 2>&1; then note "pnpm test (frontend)" PASS; else note "pnpm test (frontend)" FAIL; fail=1; fi
if pnpm --dir packages/pi-terax test >/tmp/pres-pi.log 2>&1; then note "pnpm test (pi-terax)" PASS; else note "pnpm test (pi-terax)" FAIL; fail=1; fi
if pnpm check-types >/tmp/pres-types.log 2>&1; then note "check-types" PASS; else note "check-types" FAIL; fail=1; fi
# Known baseline failures already present on origin/develop before this branch.
KNOWN_BASELINE="commit_files_reports_added_and_modified"
if [ "$FAST" != "--fast" ]; then
  if (cd src-tauri && cargo test --locked) >/tmp/pres-rust.log 2>&1; then
    note "cargo test --locked" PASS
  else
    new_failures=$(grep -E '^test .* \.\.\. FAILED' /tmp/pres-rust.log | grep -vF "$KNOWN_BASELINE" || true)
    if [ -z "$new_failures" ]; then
      note "cargo test --locked" "PASS (solo fallo de base conocido: $KNOWN_BASELINE)"
    else
      note "cargo test --locked" FAIL; fail=1
    fi
  fi
else
  note "cargo test --locked" "SKIPPED (--fast)"
fi

echo "=="
if [ $fail -eq 0 ]; then echo "PRESERVATION: OK"; else echo "PRESERVATION: FAILURES (logs en /tmp/pres-*.log)"; fi
exit $fail
