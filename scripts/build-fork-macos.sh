#!/usr/bin/env bash
set -euo pipefail

FORK_NAME="Terax-ARB"
FORK_IDENTIFIER="app.crynta.terax-arb"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

TAURI_CONF="$PROJECT_DIR/src-tauri/tauri.conf.json"
CARGO_TOML="$PROJECT_DIR/src-tauri/Cargo.toml"
CARGO_LOCK="$PROJECT_DIR/src-tauri/Cargo.lock"
PACKAGE_JSON="$PROJECT_DIR/package.json"
LOCAL_BIN="$PROJECT_DIR/node_modules/.bin"

usage() {
  cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Build and optionally install the $FORK_NAME fork for macOS.
Allows coexistence with the original Terax app.

Options:
  --install        Copy the .app bundle to /Applications after building
  --version VER    Set the version before building (e.g. 0.8.0)
  --debug          Build in debug mode (faster, larger binary)
  --no-restore     Keep patched config after build (for CI)
  -h, --help       Show this help

Examples:
  ./scripts/build-fork-macos.sh
  ./scripts/build-fork-macos.sh --install
  ./scripts/build-fork-macos.sh --install --version 0.8.0
EOF
  exit 0
}

INSTALL=false
VERSION=""
DEBUG=false
NO_RESTORE=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --install)   INSTALL=true; shift ;;
    --version)   VERSION="$2"; shift 2 ;;
    --debug)     DEBUG=true; shift ;;
    --no-restore) NO_RESTORE=true; shift ;;
    -h|--help)   usage ;;
    *) echo "Unknown option: $1"; usage ;;
  esac
done

if [[ "$(uname)" != "Darwin" ]]; then
  echo "Error: this script is for macOS only"
  exit 1
fi

for cmd in node cargo; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "Error: $cmd is required but not found in PATH"
    exit 1
  fi
done

if [[ ! -x "$LOCAL_BIN/tauri" ]] && ! command -v pnpm &>/dev/null; then
  echo "Error: node_modules/.bin/tauri was not found and pnpm is not available"
  echo "Run pnpm install first, then retry."
  exit 1
fi

USE_LOCAL_BUILD=false
if [[ -x "$LOCAL_BIN/tauri" && -x "$LOCAL_BIN/tsc" && -x "$LOCAL_BIN/vite" ]]; then
  USE_LOCAL_BUILD=true
elif ! command -v pnpm &>/dev/null; then
  echo "Error: local build tools were not found and pnpm is not available"
  echo "Run pnpm install first, then retry."
  exit 1
fi

cd "$PROJECT_DIR"

backup_dir=$(mktemp -d "${TMPDIR:-/tmp}/terax-fork-build.XXXXXX")
cp "$TAURI_CONF" "$backup_dir/tauri.conf.json"
cp "$CARGO_TOML" "$backup_dir/Cargo.toml"
cp "$CARGO_LOCK" "$backup_dir/Cargo.lock"
cp "$PACKAGE_JSON" "$backup_dir/package.json"

restore() {
  if [[ "$NO_RESTORE" == "false" ]]; then
    cp "$backup_dir/tauri.conf.json" "$TAURI_CONF"
    cp "$backup_dir/Cargo.toml" "$CARGO_TOML"
    cp "$backup_dir/Cargo.lock" "$CARGO_LOCK"
    cp "$backup_dir/package.json" "$PACKAGE_JSON"
    echo "Restored original config files"
  fi
  rm -rf "$backup_dir"
}
trap restore EXIT

echo "Patching app identity: $FORK_NAME ($FORK_IDENTIFIER)"

TAURI_CONF="$TAURI_CONF" \
FORK_NAME="$FORK_NAME" \
FORK_IDENTIFIER="$FORK_IDENTIFIER" \
USE_LOCAL_BUILD="$USE_LOCAL_BUILD" \
node -e "
const fs = require('fs');
const confPath = process.env.TAURI_CONF;
const conf = JSON.parse(fs.readFileSync(confPath, 'utf8'));
conf.productName = process.env.FORK_NAME;
conf.identifier = process.env.FORK_IDENTIFIER;
conf.app.windows[0].title = process.env.FORK_NAME;
if (process.env.USE_LOCAL_BUILD === 'true') {
  conf.build.beforeBuildCommand = 'node_modules/.bin/tsc && node_modules/.bin/vite build';
}
if (conf.bundle) {
  conf.bundle.createUpdaterArtifacts = false;
}
fs.writeFileSync(confPath, JSON.stringify(conf, null, 2) + '\n');
"

sed -i '' "s/^name = \"terax\"/name = \"terax-arb\"/" "$CARGO_TOML"

if [[ -n "$VERSION" ]]; then
  echo "Setting version to $VERSION"
  node scripts/set-version.mjs "$VERSION"
fi

echo "Building $FORK_NAME..."
BUILD_ARGS=()
if [[ "$DEBUG" == "true" ]]; then
  BUILD_ARGS+=(--debug)
fi

if [[ -x "$LOCAL_BIN/tauri" ]]; then
  "$LOCAL_BIN/tauri" build --bundles app "${BUILD_ARGS[@]}"
else
  pnpm tauri build --bundles app "${BUILD_ARGS[@]}"
fi

if [[ "$DEBUG" == "true" ]]; then
  BUNDLE_DIR="$PROJECT_DIR/src-tauri/target/debug/bundle/macos"
else
  BUNDLE_DIR="$PROJECT_DIR/src-tauri/target/release/bundle/macos"
fi

APP_BUNDLE="$BUNDLE_DIR/$FORK_NAME.app"

if [[ ! -d "$APP_BUNDLE" ]]; then
  echo "Error: expected bundle not found at $APP_BUNDLE"
  echo "Contents of $BUNDLE_DIR:"
  ls -la "$BUNDLE_DIR" 2>/dev/null || echo "(directory does not exist)"
  exit 1
fi

echo ""
echo "Build complete: $APP_BUNDLE"

if [[ "$INSTALL" == "true" ]]; then
  DEST="/Applications/$FORK_NAME.app"
  if [[ -d "$DEST" ]]; then
    echo "Removing previous installation at $DEST"
    rm -rf "$DEST"
  fi
  echo "Installing to $DEST"
  cp -R "$APP_BUNDLE" "$DEST"
  echo "Installed $FORK_NAME to /Applications"
  echo ""
  echo "You can now run both apps side by side:"
  echo "  - Terax        (original)  -> /Applications/Terax.app"
  echo "  - $FORK_NAME   (fork)      -> /Applications/$FORK_NAME.app"
fi
