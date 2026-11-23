#!/usr/bin/env bash
set -euo pipefail

root=$(git rev-parse --show-toplevel)
output=${1:?"Usage: capture-shell-resize.sh <new output directory> [modern bash]"}
bash_binary=${2:-/opt/homebrew/bin/bash}
mkdir "$output"
output=$(cd "$output" && pwd)
scripts="$root/src-tauri/src/modules/pty/scripts"
work="$output/a-rather-long-project-directory-name/with-several-nested-levels/so-the-first-prompt-row-wraps/at-eighty-columns"
mkdir -p "$work" "$output/zsh-integration" "$output/zsh-user" "$output/bash-user"
cp "$root/scripts/terminal-qa/sample.txt" "$work/"

for file in zshenv zprofile zshrc zlogin; do
  cp "$scripts/$file.zsh" "$output/zsh-integration/.$file"
done
cat > "$output/zsh-user/.zshrc" <<'EOF'
setopt PROMPT_SUBST
PROMPT=$'%F{242}\u256d\u2500%f %F{51}\U0001f4c2 %~%f\n%F{242}\u2570\u2500%f%F{201}\u276f%f '
EOF
cat > "$output/bash-user/.bashrc" <<'EOF'
PS1='\[\e[36m\]top-line \w\[\e[0m\]\nL2\$ '
EOF

capture() {
  local label=$1
  shift
  local scenario
  scenario=$(python3 - "$work" "$@" <<'PY'
import json
import sys

steps = [
    ["wait", 1], ["type", "cat sample.txt\r", 1],
    ["type", "echo this is a long command line that wraps beyond the terminal width", 1],
]
steps += [["resize", width, 24, 0.4] for width in (50, 120, 80, 40, 100, 80)]
steps += [["type", "\r", 1], ["type", "echo second command", 0.5]]
steps += [["resize", width, 24, 0.4] for width in (60, 130, 80)]
print(json.dumps({"size": [80, 24], "cwd": sys.argv[1], "argv": sys.argv[2:], "steps": steps}))
PY
)
  python3 "$root/scripts/terminal-qa/capture.py" "$output/$label.json" "$scenario"
}

capture zsh env -u __TERAX_HOOKS_LOADED -u TERAX_BLOCKS \
  "HOME=$output/zsh-user" "ZDOTDIR=$output/zsh-integration" \
  "TERAX_USER_ZDOTDIR=$output/zsh-user" TERAX_SHELL_INTEGRATION_TOKEN=tok123 /bin/zsh -i
capture bash env -u __TERAX_HOOKS_LOADED -u TERAX_BLOCKS \
  "HOME=$output/bash-user" TERAX_SHELL_INTEGRATION_TOKEN=tok123 \
  "$bash_binary" --rcfile "$scripts/bashrc.bash" -i
