# terax-shell-integration (fish)
# Emits OSC 7 (cwd) + OSC 133 A/B/C/D so the host tracks cwd and prompt
# boundaries without re-parsing the prompt. fish 4.0+ writes its own OSC 133
# A/B (the `mark-prompt` feature); Terax disables it at spawn via
# fish_features=no-mark-prompt so these markers aren't emitted twice.

# Installed into conf.d, which every fish session sources; only Terax-spawned
# shells (TERAX_TERMINAL=1) may get their prompt wrapped.
if not set -q TERAX_TERMINAL
    exit 0
end
if set -q __TERAX_HOOKS_LOADED
    exit 0
end
set -g __TERAX_HOOKS_LOADED 1
set -g __terax_aid ''
if set -q TERAX_SHELL_INTEGRATION_TOKEN; and test -n "$TERAX_SHELL_INTEGRATION_TOKEN"
    set -g __terax_aid ";aid=$TERAX_SHELL_INTEGRATION_TOKEN"
end

# Terax is a clean terminal; drop fish's default startup greeting. A user who
# sets their own in config.fish (sourced after this) keeps it.
function fish_greeting
end

set -g __TERAX_HOST (uname -n 2>/dev/null; or echo localhost)

# URL-encode a path keeping `/` intact so it stays valid inside file://.
function __terax_urlencode_path
    set -l parts (string split '/' -- $argv[1])
    set -l out
    for p in $parts
        if test -n "$p"
            set out $out (string escape --style=url -- $p)
        else
            set out $out ""
        end
    end
    string join '/' $out
end

function __terax_restore_status
    return $argv[1]
end

function __terax_capture_user_prompt
    if not functions -q fish_prompt
        return
    end
    if functions fish_prompt | string match -q '*__terax_user_prompt*'
        return
    end
    functions -e __terax_user_prompt 2>/dev/null
    functions -c fish_prompt __terax_user_prompt
end

# Wrapped so `fish -C __terax_install_prompt` can re-run it AFTER config.fish,
# where a framework prompt (starship etc.) would otherwise override fish_prompt
# and drop our markers.
function __terax_install_prompt
    __terax_capture_user_prompt
    if set -q TERAX_BLOCKS
        function fish_right_prompt
        end
        function fish_greeting
        end
    end
    function fish_prompt
        set -l __terax_status $status
        printf '\e]133;D;%d%s\e\\' $__terax_status "$__terax_aid"
        printf '\e]7;file://%s%s\e\\' "$__TERAX_HOST" (__terax_urlencode_path "$PWD")
        printf '\e]133;A%s\e\\' "$__terax_aid"
        # Block mode: host renders its own input bar, so suppress the shell prompt
        # (B marker only) and reserve header/gap rows, mirroring zsh.
        if set -q TERAX_BLOCKS
            if set -q __terax_block_seen
                printf '\n\n'
            else
                printf '\n'
            end
            printf '\e]133;B%s\e\\' "$__terax_aid"
            return
        end
        __terax_restore_status $__terax_status
        if functions -q __terax_user_prompt
            __terax_user_prompt
        else
            printf '%s > ' (prompt_pwd)
        end
        printf '\e]133;B%s\e\\' "$__terax_aid"
    end
end
__terax_install_prompt

# The launcher calls this after config.fish so a custom Codex function wins.
function __terax_install_codex
    if test "$TERAX_KITTY_GRAPHICS" = 1; and not functions -q codex
        function codex
            set -l kitty_id 0
            if set -q KITTY_WINDOW_ID
                set kitty_id "$KITTY_WINDOW_ID"
            end
            set -lx KITTY_WINDOW_ID "$kitty_id"
            command codex $argv
        end
    end
end

# Opens a file or piped text in the Reader panel under this terminal (--tab: a Reader tab).
function terax-read
    if not set -q TERAX_APP_EXE; or test -z "$TERAX_APP_EXE"
        echo 'terax-read: TERAX_APP_EXE is unset; run it inside a Terax terminal' >&2
        return 1
    end
    $TERAX_APP_EXE --read $argv
end

function __terax_preexec --on-event fish_preexec
    set -g __terax_block_seen 1
    set -l cmd (string replace -ra '[\x00-\x1f\x7f]' ' ' -- "$argv")
    if test -n "$__terax_aid"; and set -q TERAX_BLOCKS
        set -l encoded (string escape --style=url -- "$argv[1]")
        if test (string length -- "$encoded") -le 3145728
            printf '\e]133;C%s;cmdline_url=%s\e\\' "$__terax_aid" "$encoded"
        else
            printf '\e]133;C%s\e\\' "$__terax_aid"
        end
    else if test -n "$__terax_aid"
        printf '\e]133;C%s;cmdline_url=%s\e\\' "$__terax_aid" (string escape --style=url -- (string sub -l 256 -- "$cmd"))
    else
        printf '\e]133;C;%s\e\\' (string sub -l 256 -- "$cmd")
    end
end
