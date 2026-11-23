# terax-shell-integration (zshrc)
#
# Emits OSC 7 (cwd) + OSC 133 A/P/B/C/D (prompt-start / prompt-line /
# prompt-end / pre-exec / command-done-with-exit-code) so the host can detect
# command boundaries, track cwd without re-parsing the prompt, and keep the
# prompt intact when the window is resized. `status` is a read-only special in
# zsh, so we shadow $? into `_terax_ret`.

{
  _terax_user_zdotdir="${TERAX_USER_ZDOTDIR:-$HOME}"
  [ -f "$_terax_user_zdotdir/.zshrc" ] && source "$_terax_user_zdotdir/.zshrc"
  unset _terax_user_zdotdir
}

# Re-source guard within a single shell (e.g. user runs `source ~/.zshrc`).
# This is NOT exported, so each nested zsh installs its own hooks — desired,
# since every interactive shell needs its own prompt integration.
if [[ -z "$__TERAX_HOOKS_LOADED" ]]; then
  __TERAX_HOOKS_LOADED=1
  autoload -Uz add-zsh-hook 2>/dev/null
  _terax_aid=''
  [[ -n "$TERAX_SHELL_INTEGRATION_TOKEN" ]] && _terax_aid=";aid=$TERAX_SHELL_INTEGRATION_TOKEN"
  # Prompt marks carried by PS1 itself, so zsh writes them again every time it
  # repaints the prompt (window resize, clear-screen, reset-prompt): the first
  # prompt row (P) and the end of the prompt, where typing starts (B).
  _terax_prompt_start=$'%{\e]133;P;k=i'"$_terax_aid"$'\e\\%}'
  _terax_prompt_end=$'%{\e]133;B'"$_terax_aid"$'\e\\%}'

  # URL-encode $PWD byte-wise so multi-byte paths stay valid in the `file://`
  # URI emitted via OSC 7. `no_multibyte` forces ${s[i]} to index bytes (not
  # code points), and LC_ALL=C keeps the [a-zA-Z0-9...] class single-byte.
  _terax_urlencode() {
    emulate -L zsh
    setopt localoptions no_multibyte
    local LC_ALL=C s="$1" i byte
    for (( i=1; i<=${#s}; i++ )); do
      byte="${s[i]}"
      case "$byte" in
        [a-zA-Z0-9/._~-]) printf '%s' "$byte" ;;
        *) printf '%%%02X' "'$byte" ;;
      esac
    done
  }

  _terax_precmd() {
    local _terax_ret=$?
    printf '\e]133;D;%s%s\e\\' "$_terax_ret" "$_terax_aid"
    printf '\e]7;file://%s%s\e\\' "${HOST}" "$(_terax_urlencode "$PWD")"
    # PS1 is marked afresh for every prompt and cleaned again in preexec, so
    # themes that inspect or rebuild it (p10k, starship, pure) never find the
    # marks piling up; whatever they left of an earlier marking goes first.
    PS1=${${PS1//$_terax_prompt_start/}//$_terax_prompt_end/}
    # In block mode the host renders its own input bar, so suppress the shell
    # prompt entirely (keep only the marks) and add a leading blank line so
    # frozen command blocks get vertical breathing room.
    if [[ -n "$TERAX_BLOCKS" ]]; then
      # Spacing reserved for the host-drawn block header lives in the prompt
      # (the grid is WebGL, not CSS). Later prompts get two blank rows: the
      # upper one is the previous block's end gap (above its divider), the lower
      # one is this command's header row. The very first prompt has no block
      # above it, so it gets a single row (header only) to avoid a tall top gap.
      if [[ -n "$_terax_block_seen" ]]; then
        PS1=$'\n\n'
      else
        PS1=$'\n'
      fi
      RPROMPT=''
    fi
    local _terax_redraw='' _terax_unmarked=''
    if [[ -o prompt_percent ]]; then
      # A bare trailing % would join the mark's %{ into an escape of its own.
      [[ "$PS1" == *[^%]% || "$PS1" == % ]] && PS1="$PS1%"
      PS1="${_terax_prompt_start}${PS1}${_terax_prompt_end}"
      # On a window resize zsh repaints the whole prompt from its first row
      # with a row count the terminal's reflow made stale. terax_redraw=1
      # tells Terax to blank the prompt before it reflows, from the P mark
      # down. Only promise it when the marks will reach the terminal (this
      # hook is the last to touch PS1) and preexec will say when the prompt
      # is over.
      if (( ${preexec_functions[(Ie)_terax_preexec]} )); then
        if [[ "${precmd_functions[-1]}" == _terax_precmd ]]; then
          _terax_redraw=';terax_redraw=1'
        elif (( ${precmd_functions[(Ie)_terax_precmd]} )); then
          # Be the last one from the next prompt on.
          precmd_functions=(${precmd_functions:#_terax_precmd} _terax_precmd)
        fi
      fi
    else
      # PS1 is printed verbatim and cannot carry marks.
      _terax_unmarked=1
    fi
    printf '\e]133;A%s%s\e\\' "$_terax_aid" "$_terax_redraw"
    if [[ -n "$_terax_unmarked" ]]; then
      printf '\e]133;B%s\e\\' "$_terax_aid"
    fi
  }

  _terax_preexec() {
    # Hand PS1 back clean to whatever reads it while the command runs.
    PS1=${${PS1//$_terax_prompt_start/}//$_terax_prompt_end/}
    # Mark that a real command ran, so the next prompt switches from one blank
    # row (first prompt, no block above) to two (end gap + header row).
    [[ -n "$TERAX_BLOCKS" ]] && _terax_block_seen=1
    local cmd="${1//[[:cntrl:]]/ }"
    if [[ -n "$_terax_aid" && -n "$TERAX_BLOCKS" ]]; then
      setopt localoptions no_multibyte
      local LC_ALL=C
      if (( ${#1} <= 1048576 )); then
        printf '\e]133;C%s;cmdline_url=%s\e\\' "$_terax_aid" "$(_terax_urlencode "$1")"
      else
        printf '\e]133;C%s\e\\' "$_terax_aid"
      fi
    elif [[ -n "$_terax_aid" ]]; then
      printf '\e]133;C%s;cmdline_url=%s\e\\' "$_terax_aid" "$(_terax_urlencode "${cmd[1,256]}")"
    else
      printf '\e]133;C;%s\e\\' "${cmd[1,256]}"
    fi
  }

  if (( $+functions[add-zsh-hook] )); then
    add-zsh-hook precmd _terax_precmd
    add-zsh-hook preexec _terax_preexec
  fi

  # Warp/iTerm2-style word-end navigation: zsh's default `forward-word` (M-f /
  # Option+Right) overshoots to the START of the next word; `emacs-forward-word`
  # stops at the END of the current word, which is what nearly every other shell
  # and GUI editor does. Only rebind when the binding is still the stock zsh
  # default — respects any explicit remap in the user's .zshrc.
  if (( $+widgets[emacs-forward-word] )) \
     && [[ "$(bindkey '\ef')" == '"^[f" forward-word' ]]; then
    bindkey '\ef' emacs-forward-word
  fi

  # Opens a file or piped text in the Reader panel under this terminal (--tab: a Reader tab).
  terax-read() {
    if [[ -z "$TERAX_APP_EXE" ]]; then
      print -u2 'terax-read: TERAX_APP_EXE is unset; run it inside a Terax terminal'
      return 1
    fi
    "$TERAX_APP_EXE" --read "$@"
  }

  _terax_precmd
fi
:
