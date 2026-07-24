#!/usr/bin/env bash
set -euo pipefail

REPOSITORY="${TERAX_REPOSITORY:-Sendery/terax-ai}"
RELEASE_TAG="${TERAX_RELEASE_TAG:-v0.9.0-dev.0}"
APP_VERSION="${TERAX_APP_VERSION:-0.9.0-0}"
WORKTREE="${TERAX_WORKTREE:-$HOME/Library/Caches/terax-dev-release}"
HOST_OS="${TERAX_HOST_OS:-$(uname -s)}"

if [[ "$HOST_OS" != "Darwin" ]]; then
  echo "This release builder requires macOS." >&2
  exit 1
fi

for tool in git node pnpm cargo rustc rustup gh xcodebuild shasum file; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "Missing required tool: $tool" >&2
    exit 1
  fi
done

gh auth status >/dev/null

SOURCE_COMMIT="$(
  gh api "repos/$REPOSITORY/releases?per_page=100" \
    --jq ".[] | select(.draft == true and .tag_name == \"$RELEASE_TAG\") | .target_commitish" \
    | head -n 1
)"

if [[ ! "$SOURCE_COMMIT" =~ ^[0-9a-fA-F]{40}$ ]]; then
  echo "Draft $RELEASE_TAG is missing or is not pinned to a full source commit." >&2
  exit 1
fi

if [[ ! -d "$WORKTREE/.git" ]]; then
  if [[ -e "$WORKTREE" ]]; then
    echo "Worktree path exists but is not a Git checkout: $WORKTREE" >&2
    exit 1
  fi
  git clone "https://github.com/$REPOSITORY.git" "$WORKTREE"
fi

git -C "$WORKTREE" fetch origin --prune
git -C "$WORKTREE" checkout --detach "$SOURCE_COMMIT"
git -C "$WORKTREE" reset --hard "$SOURCE_COMMIT"
git -C "$WORKTREE" clean -ffd

if [[ "$(git -C "$WORKTREE" rev-parse HEAD)" != "$SOURCE_COMMIT" ]]; then
  echo "The build checkout does not match the draft source commit." >&2
  exit 1
fi

cd "$WORKTREE"
pnpm install --frozen-lockfile
rustup target add aarch64-apple-darwin
rustup target add x86_64-apple-darwin

CONFIG_FILE="$(mktemp -t terax-dev-release)"
cleanup() {
  rm -f "$CONFIG_FILE"
}
trap cleanup EXIT

# Rebrand the desktop identity to Pi-Terax and disable updater artifacts.
# The override is derived from the checked-out config so window settings other
# than the title are preserved verbatim.
node scripts/dev-release-config.mjs src-tauri/tauri.conf.json >"$CONFIG_FILE"

rm -rf \
  src-tauri/target/aarch64-apple-darwin/release/bundle \
  src-tauri/target/x86_64-apple-darwin/release/bundle

node scripts/build-version.mjs "$APP_VERSION" -- \
  --target aarch64-apple-darwin \
  --bundles app,dmg \
  --no-sign \
  --config "$CONFIG_FILE"

node scripts/build-version.mjs "$APP_VERSION" -- \
  --target x86_64-apple-darwin \
  --bundles app,dmg \
  --no-sign \
  --config "$CONFIG_FILE"

shopt -s nullglob
ARM_DMG=(src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/*.dmg)
INTEL_DMG=(src-tauri/target/x86_64-apple-darwin/release/bundle/dmg/*.dmg)

if [[ ${#ARM_DMG[@]} -ne 1 || ${#INTEL_DMG[@]} -ne 1 ]]; then
  echo "Expected exactly one ARM64 DMG and one Intel DMG." >&2
  exit 1
fi

file "${ARM_DMG[@]}" "${INTEL_DMG[@]}"
shasum -a 256 "${ARM_DMG[@]}" "${INTEL_DMG[@]}"

gh release upload "$RELEASE_TAG" \
  "${ARM_DMG[@]}" \
  "${INTEL_DMG[@]}" \
  --repo "$REPOSITORY" \
  --clobber

# Companion Pi extension, aligned with this release tag (platform-independent).
EXTENSION_VERSION="${RELEASE_TAG#v}"
node scripts/publish-extension.mjs "$EXTENSION_VERSION" \
  --tag "$RELEASE_TAG" \
  --repo "$REPOSITORY"

gh release view "$RELEASE_TAG" \
  --repo "$REPOSITORY" \
  --json tagName,isDraft,isPrerelease,assets,url

echo "macOS ARM64 and Intel artifacts uploaded to draft $RELEASE_TAG."
