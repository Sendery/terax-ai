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

for tool in git node pnpm cargo rustc rustup gh xcodebuild shasum file lipo; do
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
  [[ -n "${DOWNLOAD_DIR:-}" ]] && rm -rf "$DOWNLOAD_DIR"
}
trap cleanup EXIT

# Rebrand the desktop identity to Pi-Terax and disable updater artifacts.
# The override is derived from the checked-out config so window settings other
# than the title are preserved verbatim.
node scripts/dev-release-config.mjs src-tauri/tauri.conf.json >"$CONFIG_FILE"

BUNDLE_ROOT=src-tauri/target/universal-apple-darwin/release/bundle

rm -rf "$BUNDLE_ROOT"

# One universal build replaces the previous pair of per-architecture builds, so
# users get a single macOS download that runs natively on Apple Silicon and Intel.
node scripts/build-version.mjs "$APP_VERSION" -- \
  --target universal-apple-darwin \
  --bundles app,dmg \
  --no-sign \
  --config "$CONFIG_FILE"

shopt -s nullglob
UNIVERSAL_DMG=("$BUNDLE_ROOT"/dmg/*.dmg)
UNIVERSAL_APP=("$BUNDLE_ROOT"/macos/*.app)

if [[ ${#UNIVERSAL_DMG[@]} -ne 1 || ${#UNIVERSAL_APP[@]} -ne 1 ]]; then
  echo "Expected exactly one universal DMG and one universal .app bundle." >&2
  exit 1
fi

# Prove the bundle really is fat before publishing it: a universal target that
# silently produced a single-architecture binary would ship a broken download to
# half the users.
APP_BINARY="$(find "${UNIVERSAL_APP[0]}/Contents/MacOS" -maxdepth 1 -type f -perm +111 | head -n 1)"
BUNDLE_ARCHS="$(lipo -archs "$APP_BINARY")"
echo "Bundle architectures: $BUNDLE_ARCHS"
for required in arm64 x86_64; do
  if [[ " $BUNDLE_ARCHS " != *" $required "* ]]; then
    echo "The universal bundle is missing the $required slice: $BUNDLE_ARCHS" >&2
    exit 1
  fi
done

# Publish under the hardware names the Apple menu shows, not Apple's toolchain
# jargon, so the download choice is unambiguous.
DOWNLOAD_DIR="$(mktemp -d)"
DOWNLOAD_DMG="$DOWNLOAD_DIR/$(basename "${UNIVERSAL_DMG[0]}" | sed 's/_universal\.dmg$/_apple_silicon_intel.dmg/')"
cp "${UNIVERSAL_DMG[0]}" "$DOWNLOAD_DMG"

file "$DOWNLOAD_DMG"
shasum -a 256 "$DOWNLOAD_DMG"

gh release upload "$RELEASE_TAG" \
  "$DOWNLOAD_DMG" \
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

echo "Universal macOS artifact (Apple Silicon + Intel) uploaded to draft $RELEASE_TAG."
