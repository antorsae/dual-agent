#!/bin/bash
# Shared by setup and uninstall. A row identifies one caller and one config home.

canonical_home() {
    local path="$1" parent name
    case "$path" in
        '~') path="$HOME" ;;
        '~/'*) path="$HOME/${path#\~/}" ;;
        /*) ;;
        *) echo "Use an absolute home path or ~/path: $path" >&2; return 1 ;;
    esac
    while [[ "$path" != / && "$path" == */ ]]; do path="${path%/}"; done
    if [ -d "$path" ]; then (unset CDPATH; cd -P -- "$path" && pwd -P); return; fi
    if [ -e "$path" ] || [ -L "$path" ]; then echo "Home is not a directory: $path" >&2; return 1; fi
    # Resolve an existing ancestor so two aliases for a new home also share a row.
    name="${path##*/}"
    parent="${path%/*}"
    parent="$(canonical_home "${parent:-/}")" || return 1
    case "$name" in
        .) printf '%s\n' "$parent" ;;
        ..) parent="${parent%/*}"; printf '%s\n' "${parent:-/}" ;;
        *) printf '%s/%s\n' "${parent%/}" "$name" ;;
    esac
}

active_home() {
    case "$1" in
        claude) printf '%s' "$ACTIVE_CLAUDE_HOME" ;;
        codex|rosalind) printf '%s' "$ACTIVE_CODEX_HOME" ;;
        agy) printf '%s' "$AGY_HOME" ;;
    esac
}

display_home_path() {
    if [[ "$1" == "$USER_HOME_PATH/"* ]]; then printf '~/%s' "${1#"$USER_HOME_PATH/"}"
    else printf '%s' "$1"; fi
}

uses_default_claude_registry() {
    [ "$1" = "$DEFAULT_CLAUDE_HOME" ] && { [ -z "${CLAUDE_CONFIG_DIR:-}" ] || [ "$1" != "$ACTIVE_CLAUDE_HOME" ]; }
}

caller_registry() {
    local host="$1" caller_home="$2"
    case "$host" in
        claude)
            if uses_default_claude_registry "$caller_home"; then
                printf '%s' "$HOME/.claude.json"
            else
                printf '%s' "$caller_home/.claude.json"
            fi ;;
        codex) printf '%s' "$caller_home/config.toml" ;;
        agy) printf '%s' "$HOME/.gemini/config/mcp_config.json" ;;
    esac
}

caller_cli() {
    local host="$1" caller_home="$2"
    shift 2
    case "$host" in
        claude)
            if uses_default_claude_registry "$caller_home"; then
                (unset CLAUDE_CONFIG_DIR; claude "$@")
            else
                CLAUDE_CONFIG_DIR="$caller_home" claude "$@"
            fi ;;
        codex) CODEX_HOME="$caller_home" codex "$@" ;;
        agy) "${AGY_BIN:-agy}" "$@" ;;
    esac
}

# Result is TARGET_ROW. Calling this again with an alias returns the same row.
add_home() {
    local host="$1" path row label worker display
    path="$(canonical_home "$2")" || return 1
    for row in "${!CALLERS[@]}"; do
        if [ "${CALLERS[$row]}" = "$host" ] && [ "${CALLER_HOMES[$row]}" = "$path" ]; then
            TARGET_ROW=$row
            return 0
        fi
    done
    case "$host" in claude) label="Claude Code" ;; codex) label="Codex" ;; agy) label="AGY TUI" ;; esac
    display="$(display_home_path "$path")"
    TARGET_ROW=${#CALLERS[@]}
    CALLERS+=("$host"); CALLER_HOMES+=("$path"); CALLER_LABELS+=("$label $display")
    HOME_SELECTED+=(0)
    for worker in "${WORKERS[@]}"; do
        if [ "$host=$worker" = claude=claude ]; then CELLS+=(''); else CELLS+=("$host=$worker"); fi
        SELECTED+=(0)
    done
}

init_homes() {
    local host
    CALLERS=(); CALLER_HOMES=(); CALLER_LABELS=(); HOME_SELECTED=()
    CELLS=(); SELECTED=(); ACTIVE_ROWS=()
    USER_HOME_PATH="$(canonical_home "$HOME")" || return 1
    DEFAULT_CLAUDE_HOME="$(canonical_home "$HOME/.claude")" || return 1
    ACTIVE_CLAUDE_HOME="$(canonical_home "${CLAUDE_CONFIG_DIR:-$HOME/.claude}")" || return 1
    ACTIVE_CODEX_HOME="$(canonical_home "${CODEX_HOME:-$HOME/.codex}")" || return 1
    AGY_HOME="$(canonical_home "$HOME/.gemini/antigravity-cli")" || return 1
    for host in claude codex agy; do
        add_home "$host" "$(active_home "$host")" || return 1
        ACTIVE_ROWS+=("$TARGET_ROW")
        HOME_SELECTED[$TARGET_ROW]=1
    done
}

# Unqualified targets use the calling shell's active home. AGY has a single registry.
resolve_target() {
    local target="$1" host="${1%%@*}" path
    case "$host" in claude|codex|agy) ;; *) echo "Unsupported caller/worker target: $target" >&2; return 1 ;; esac
    if [ "$host" = "$target" ]; then path="$(active_home "$host")"
    elif [ "$host" = agy ]; then echo "AGY uses a single caller home." >&2; return 1
    else path="${target#*@}"; fi
    add_home "$host" "$path"
}

discover_homes() {
    local path
    for path in "$HOME"/.claude "$HOME"/.claude-* "$HOME"/claude-*; do
        if [ -f "$path/.claude.json" ] || [ -f "$path/settings.json" ] || { [ "$path" = "$HOME/.claude" ] && [ -f "$HOME/.claude.json" ]; }; then
            add_home claude "$path" || return 1
        fi
    done
    for path in "$HOME"/.codex "$HOME"/.codex-* "$HOME"/codex-*; do
        if [ -f "$path/config.toml" ]; then add_home codex "$path" || return 1; fi
    done
}

preselect_home() {
    local row="$1" host="${CALLERS[$1]}" registry detected column index
    command -v node >/dev/null 2>&1 || return 0
    registry="$(caller_registry "$host" "${CALLER_HOMES[$row]}")"
    if ! detected="$(node "$SCRIPT_DIR/scripts/installed-integrations.mjs" --installed "$host" "$registry" "${WORKERS[@]}" gemini)"; then
        echo "Could not detect registrations in $registry. Select this home manually." >&2
        return 0
    fi
    while IFS= read -r column; do
        [[ "$column" =~ ^[0-9]+$ ]] || continue
        HOME_SELECTED[$row]=1
        [ "$column" -lt "${#WORKERS[@]}" ] || continue
        index=$((row * ${#WORKERS[@]} + column))
        [ -z "${CELLS[$index]}" ] || SELECTED[$index]=1
    done <<< "$detected"
}

order_homes() {
    local host row
    HOME_ORDER=()
    for host in claude codex agy; do
        for row in "${!CALLERS[@]}"; do
            if [ "${CALLERS[$row]}" = "$host" ]; then HOME_ORDER+=("$row"); fi
        done
    done
}

set_all_homes() {
    local row
    for row in "${!CALLERS[@]}"; do HOME_SELECTED[$row]="$1"; done
}

# Accept the earlier number-list input as well as individual key presses.
select_home_numbers() {
    local operation="$2" index row value=1
    picker_number_list "$1" "${#HOME_ORDER[@]}" || return 1
    case "$operation" in replace) set_all_homes 0 ;; drop) value=0 ;; esac
    for index in "${PICKER_NUMBERS[@]}"; do row="${HOME_ORDER[$index]}"; HOME_SELECTED[$row]=$value; done
}

choose_homes() {
    local action="$1" enter_action="$2" row i checked marker style target count selected previous_count
    local notice="" number_prompt="Choose home numbers from the list."
    discover_homes || fail "Could not resolve caller homes."
    for row in "${!CALLERS[@]}"; do preselect_home "$row"; done
    order_homes
    picker_open
    while true; do
        count=${#HOME_ORDER[@]}
        picker_frame "$count" 4
        picker_hint 2 "Which caller homes should $action?"
        picker_hint 1 "↑↓ move  Space toggle  Enter $enter_action  q quit"
        picker_hint 4 "PgUp/Dn page   a all   n clear   + add home"
        for ((i=PICKER_FIRST; i<PICKER_END; i++)); do
            row="${HOME_ORDER[$i]}"; checked='[ ]'; marker=' '; style=''
            if [ "${HOME_SELECTED[$row]}" -eq 1 ]; then checked='[x]'; fi
            if [ "$i" -eq "$PICKER_ROW" ]; then marker='>'; style=focus; fi
            picker_line "$marker $checked ${CALLER_LABELS[$row]}" "$style"
        done
        selected=0
        for row in "${HOME_ORDER[@]}"; do selected=$((selected + HOME_SELECTED[row])); done
        picker_hint 3 "${notice:-$selected selected   Homes $((PICKER_FIRST + 1))–$PICKER_END of $count}"
        notice=""
        picker_read_key
        if picker_move "$count"; then continue; fi
        row="${HOME_ORDER[$PICKER_ROW]}"
        case "$PICKER_KEY" in
            enter) picker_close; return 0 ;;
            space) HOME_SELECTED[$row]=$((1 - HOME_SELECTED[row])) ;;
            a|A) set_all_homes 1 ;;
            n|N) set_all_homes 0 ;;
            +)
                if [ "${CALLERS[$row]}" = agy ]; then
                    picker_prompt "Add claude@/path or codex@/path (Enter to go back): "
                else
                    picker_prompt "Add a ${CALLERS[$row]} home (path or caller@/path, Enter to go back): "
                fi
                case "$PICKER_INPUT" in
                    '') continue ;;
                    [0-9]*) select_home_numbers "$PICKER_INPUT" add || notice="$number_prompt"; continue ;;
                    claude@*|codex@*) target="$PICKER_INPUT" ;;
                    /*|'~'|'~/'*) target="${CALLERS[$row]}@$PICKER_INPUT" ;;
                    *) notice="Use an absolute path, ~/path, or caller@/path."; continue ;;
                esac
                previous_count=$count
                if ! resolve_target "$target"; then notice="Could not add $target. Check the caller and path."; continue; fi
                if [ "$TARGET_ROW" -ge "$previous_count" ]; then preselect_home "$TARGET_ROW"; fi
                HOME_SELECTED[$TARGET_ROW]=1
                order_homes
                for i in "${!HOME_ORDER[@]}"; do
                    if [ "${HOME_ORDER[$i]}" -eq "$TARGET_ROW" ]; then PICKER_ROW=$i; break; fi
                done ;;
            [0-9]|-)
                picker_prompt "Home numbers: $PICKER_KEY"
                if [ "$PICKER_KEY" = - ]; then select_home_numbers "$PICKER_INPUT" drop || notice="$number_prompt"
                elif select_home_numbers "$PICKER_KEY$PICKER_INPUT" replace; then picker_close; return 0
                else notice="$number_prompt"; fi ;;
        esac
    done
}
