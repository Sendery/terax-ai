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
  }

  # Prompt marks carried by PS1 and PS2 themselves, so readline writes them
  # again whenever it repaints: the start of each prompt line (P) and the end
  # of the prompt, where typing starts (B).
  _terax_ps_start='\[\e]133;P;k=i'"$_terax_aid"'\e\\\]'
  _terax_ps_line='\[\e]133;P;k=s'"$_terax_aid"'\e\\\]'
  _terax_ps_end='\[\e]133;B'"$_terax_aid"'\e\\\]'
  _terax_ps_newline='\n'"$_terax_ps_line"
  _terax_can_redraw=''

  # Runs after every other PROMPT_COMMAND entry, so it marks the PS1 that is
  # about to be printed even when a prompt framework rebuilds it each time.
  _terax_prompt() {
    PS1=${PS1//"$_terax_ps_start"/}
    PS1=${PS1//"$_terax_ps_line"/}
    PS1=${PS1//"$_terax_ps_end"/}
    PS2=${PS2//"$_terax_ps_line"/}
    if [ -n "$TERAX_BLOCKS" ]; then
      # Host renders its own input bar: suppress the shell prompt (marks
      # only) and reserve header/gap rows, mirroring the zsh integration.
      if [ -n "$_terax_block_seen" ]; then
        PS1='\n\n'
      else
        PS1='\n'
      fi
    fi
    # On a window resize readline repaints only the last prompt line, with a
    # row count the terminal's reflow made stale. terax_redraw=1 tells Terax
    # to blank that line before it reflows, from its P mark down. Only
    # promise it when every line can be marked (a literal newline may sit
    # inside a command substitution, where a mark would break the syntax) and
    # nothing runs after this hook that could replace PS1.
    local _terax_redraw=''
    case "$PS1" in
      *$'\n'*) ;;
      *)
        case "${PROMPT_COMMAND[*]}" in
          *_terax_prompt) _terax_redraw=$_terax_can_redraw ;;
        esac
        ;;
    esac
    PS1=${_terax_ps_start}${PS1//\\n/$_terax_ps_newline}${_terax_ps_end}
    PS2=${_terax_ps_line}${PS2}
    printf '\e]133;A%s%s\e\\' "$_terax_aid" "$_terax_redraw"
  }

  case "${PROMPT_COMMAND[*]}" in
    *_terax_precmd*) ;;
    *)
      if [ "${#PROMPT_COMMAND[@]}" -gt 1 ]; then
        # An array (bash 5.1+): every element runs, in order.
        PROMPT_COMMAND=(_terax_precmd "${PROMPT_COMMAND[@]}" _terax_prompt)
      else
        PROMPT_COMMAND="_terax_precmd${PROMPT_COMMAND:+;$PROMPT_COMMAND}"$'\n'"_terax_prompt"
      fi
      ;;
  esac

  # Pre-exec marker via PS0 (bash 4.4+). PS0 is expanded just before a command
  # runs — cleaner than a DEBUG trap, which would clobber user traps and fire
  # on every command including inside PROMPT_COMMAND.
  if [ "${BASH_VERSINFO[0]:-0}" -gt 4 ] \
     || { [ "${BASH_VERSINFO[0]:-0}" -eq 4 ] && [ "${BASH_VERSINFO[1]:-0}" -ge 4 ]; }; then
    # Only with a pre-exec mark does Terax know when the prompt is over.
    _terax_can_redraw=';terax_redraw=1'
    if [ -n "$TERAX_BLOCKS" ]; then
      # PS0 only expands, never executes: the arithmetic inside the array
      # subscript sets the seen flag while the unset array expands to nothing.
      PS0='\[\e]133;C'"$_terax_aid"'\e\\\]${_terax_noop[$((_terax_block_seen=1))]}'"${PS0:-}"
    else
      PS0='\[\e]133;C'"$_terax_aid"'\e\\\]'"${PS0:-}"
    fi
  fi

  # Opens a file or piped text in the Reader panel under this terminal (--tab: a Reader tab).
  terax-read() {
    if [ -z "$TERAX_APP_EXE" ]; then
      printf '%s\n' 'terax-read: TERAX_APP_EXE is unset; run it inside a Terax terminal' >&2
      return 1
    fi
    "$TERAX_APP_EXE" --read "$@"
  }

  _terax_precmd
  _terax_prompt
fi
:
