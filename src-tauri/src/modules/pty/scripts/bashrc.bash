# terax-shell-integration (bashrc)
#
# Differences vs zsh integration:
# - We emulate login-shell init manually (/etc/profile, profile files) because
#   bash ignores --rcfile when started with -l.
# - Pre-exec marker uses PS0 (bash 4.4+). On older bash (macOS default 3.2) we
#   skip it — a fragile DEBUG-trap alternative would clobber the user's own
#   traps and interact badly with debuggers.

if [ -z "$__TERAX_HOOKS_LOADED" ]; then
  __TERAX_HOOKS_LOADED=1
  _terax_aid=''
  [ -n "$TERAX_SHELL_INTEGRATION_TOKEN" ] && _terax_aid=";aid=$TERAX_SHELL_INTEGRATION_TOKEN"

  [ -f /etc/profile ] && source /etc/profile
  [ -f /etc/bashrc ] && source /etc/bashrc
  if [ -f "$HOME/.bash_profile" ]; then
    source "$HOME/.bash_profile"
  elif [ -f "$HOME/.bash_login" ]; then
    source "$HOME/.bash_login"
  elif [ -f "$HOME/.profile" ]; then
    source "$HOME/.profile"
  fi
  # .bashrc may have been sourced already by .bash_profile; sourcing again is
  # safe for idempotent rc files (the common case). If yours has side effects
  # on reload, guard with a flag.
  [ -f "$HOME/.bashrc" ] && source "$HOME/.bashrc"

  _terax_urlencode() {
    local LC_ALL=C s="$1" i c
    for (( i=0; i<${#s}; i++ )); do
      c="${s:i:1}"
      case "$c" in
        [a-zA-Z0-9/._~-]) printf '%s' "$c" ;;
        *) printf '%%%02X' "'$c" ;;
      esac
    done
  }

  _terax_precmd() {
    local _terax_ret=$?
    printf '\e]133;D;%s%s\e\\' "$_terax_ret" "$_terax_aid"
    printf '\e]7;file://%s%s\e\\' "${HOSTNAME:-$(uname -n 2>/dev/null)}" "$(_terax_urlencode "$PWD")"
    if [ -n "$TERAX_BLOCKS" ]; then
      # Host renders its own input bar: suppress the shell prompt (B marker
      # only) and reserve header/gap rows, mirroring the zsh integration.
      if [ -n "$_terax_block_seen" ]; then
        PS1='\n\n\[\e]133;B'"$_terax_aid"'\e\\\]'
      else
        PS1='\n\[\e]133;B'"$_terax_aid"'\e\\\]'
      fi
    elif [ -z "$__TERAX_PS1_INJECTED" ]; then
      PS1='\[\e]133;B'"$_terax_aid"'\e\\\]'"$PS1"
      __TERAX_PS1_INJECTED=1
    fi
    printf '\e]133;A%s\e\\' "$_terax_aid"
  }

  case ":${PROMPT_COMMAND:-}:" in
    *":_terax_precmd:"*) ;;
    *) PROMPT_COMMAND="_terax_precmd${PROMPT_COMMAND:+;$PROMPT_COMMAND}" ;;
  esac

  # Pre-exec marker via PS0 (bash 4.4+). PS0 is expanded just before a command
  # runs — cleaner than a DEBUG trap, which would clobber user traps and fire
  # on every command including inside PROMPT_COMMAND.
  if [ "${BASH_VERSINFO[0]:-0}" -gt 4 ] \
     || { [ "${BASH_VERSINFO[0]:-0}" -eq 4 ] && [ "${BASH_VERSINFO[1]:-0}" -ge 4 ]; }; then
    if [ -n "$TERAX_BLOCKS" ]; then
      # PS0 only expands, never executes: the arithmetic inside the array
      # subscript sets the seen flag while the unset array expands to nothing.
      PS0='\[\e]133;C'"$_terax_aid"'\e\\\]${_terax_noop[$((_terax_block_seen=1))]}'"${PS0:-}"
    else
      PS0='\[\e]133;C'"$_terax_aid"'\e\\\]'"${PS0:-}"
    fi
  fi

  # Opens a file or piped text in this Terax's Reader tab.
  terax-read() {
    if [ -z "$TERAX_APP_EXE" ]; then
      printf '%s\n' 'terax-read: TERAX_APP_EXE is unset; run it inside a Terax terminal' >&2
      return 1
    fi
    "$TERAX_APP_EXE" --read "$@"
  }

  _terax_precmd
fi
:
