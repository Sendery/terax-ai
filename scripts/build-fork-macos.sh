#!/usr/bin/env bash
set -euo pipefail

FORK_NAME="Pi-Terax"
FORK_IDENTIFIER="app.crynta.pi-terax"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

TAURI_CONF="$PROJECT_DIR/src-tauri/tauri.conf.json"
CARGO_TOML="$PROJECT_DIR/src-tauri/Cargo.toml"

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

for cmd in pnpm node cargo; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "Error: $cmd is required but not found in PATH"
    exit 1
  fi
done

cd "$PROJECT_DIR"

tauri_conf_backup=$(cat "$TAURI_CONF")
cargo_toml_backup=$(cat "$CARGO_TOML")

restore() {
  if [[ "$NO_RESTORE" == "false" ]]; then
    echo "$tauri_conf_backup" > "$TAURI_CONF"
    echo "$cargo_toml_backup" > "$CARGO_TOML"
    echo "Restored original config files"
  fi
}
trap restore EXIT

echo "Patching app identity: $FORK_NAME ($FORK_IDENTIFIER)"

node -e "
const fs = require('fs');
const conf = JSON.parse(fs.readFileSync('$TAURI_CONF', 'utf8'));
conf.productName = '$FORK_NAME';
conf.identifier = '$FORK_IDENTIFIER';
conf.app.windows[0].title = '$FORK_NAME';
conf.bundle.createUpdaterArtifacts = false;
fs.writeFileSync('$TAURI_CONF', JSON.stringify(conf, null, 2) + '\n');
"

sed -i '' "s/^name = \"terax\"/name = \"pi-terax\"/" "$CARGO_TOML"

if [[ -n "$VERSION" ]]; then
  echo "Setting version to $VERSION"
  node scripts/set-version.mjs "$VERSION"
fi

echo "Building $FORK_NAME..."
BUILD_ARGS=()
if [[ "$DEBUG" == "true" ]]; then
  BUILD_ARGS+=(--debug)
fi

pnpm tauri build --bundles app "${BUILD_ARGS[@]}"

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
