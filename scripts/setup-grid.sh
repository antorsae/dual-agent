#!/bin/bash
# Selection is stored per cell, for both interactive and unattended setup.
select_all() {
    local index
    for index in "${!CELLS[@]}"; do
        [ -z "${CELLS[$index]}" ] || SELECTED[$index]="$1"
    done
}

select_for() {
    local spec="$1" host workers worker index found
    local -a requested=()
    host="${spec%%=*}"
    workers="${spec#*=}"
    case "$spec" in
        *=*=*|=*|*=|*=,*|*,|*,,*) fail "Invalid selection '$spec'. Use --for HOST=WORKER,WORKER." ;;
        *=*) ;;
        *) fail "Invalid selection '$spec'. Use --for HOST=WORKER,WORKER." ;;
    esac
    IFS=',' read -r -a requested <<< "$workers"
    for worker in "${requested[@]}"; do
        found=0
        for index in "${!CELLS[@]}"; do
            if [ "${CELLS[$index]}" = "$host=$worker" ]; then
                SELECTED[$index]=1
                found=1
                break
            fi
        done
        [ "$found" -eq 1 ] || fail "Unsupported caller/worker selection '$host=$worker'. See --help."
    done
    INSTALL_REQUESTED=1
}

worker_selected() {
    local index
    for index in "${!CELLS[@]}"; do
        if [ "${SELECTED[$index]}" -eq 1 ] && [ "${CELLS[$index]#*=}" = "$1" ]; then return 0; fi
    done
    return 1
}

preselect_installed() {
    local detected index
    command -v node >/dev/null 2>&1 || return 0
    if ! detected="$(node "$SCRIPT_DIR/scripts/installed-integrations.mjs" "$CLAUDE_REGISTRY" "$DELEGATE_CODEX_HOME" "$AGY_REGISTRY" "${CELLS[@]}")"; then
        echo "Could not detect installed integrations. Select them manually." >&2
        return 0
    fi
    while IFS= read -r index; do
        if [[ "$index" =~ ^[0-9]+$ ]] && [ "$index" -lt "${#CELLS[@]}" ] && [ -n "${CELLS[$index]}" ]; then SELECTED[$index]=1; fi
    done <<< "$detected"
}

render_grid() {
    local current_row="$1" current_col="$2" row column index mark
    printf '%-16s' 'Caller / worker'
    printf ' %-12s' "${WORKER_LABELS[@]}"
    printf '\n'
    for row in "${!CALLERS[@]}"; do
        printf '%-16s' "${CALLER_LABELS[$row]}"
        for column in "${!WORKERS[@]}"; do
            index=$((row * ${#WORKERS[@]} + column))
            if [ -z "${CELLS[$index]}" ]; then mark=' - '
            elif [ "${SELECTED[$index]}" -eq 1 ]; then mark='[x]'
            else mark='[ ]'; fi
            if [ "$row" -eq "$current_row" ] && [ "$column" -eq "$current_col" ]; then mark=">$mark"; else mark=" $mark"; fi
            printf ' %-12s' "$mark"
        done
        printf '\n'
    done
}

toggle_row() {
    local row="$1" column index value=0
    for column in "${!WORKERS[@]}"; do
        index=$((row * ${#WORKERS[@]} + column))
        if [ -n "${CELLS[$index]}" ] && [ "${SELECTED[$index]}" -eq 0 ]; then value=1; break; fi
    done
    for column in "${!WORKERS[@]}"; do
        index=$((row * ${#WORKERS[@]} + column))
        [ -z "${CELLS[$index]}" ] || SELECTED[$index]="$value"
    done
}

choose_from_grid() {
    local row=0 column=0 index key arrow redraw=0
    preselect_installed
    echo "Existing registrations are preselected for each caller."
    echo "Arrows move   Space toggles   r toggles row   a selects all   n clears   Enter applies"
    while true; do
        if [ "$redraw" -eq 1 ] && [ -t 1 ]; then printf '\033[%sF\033[J' "$((${#CALLERS[@]} + 1))"; fi
        render_grid "$row" "$column"
        redraw=1
        IFS= read -rsn 1 key || fail "No selection received. Use --for HOST=WORKER,WORKER for unattended setup."
        case "$key" in
            ''|$'\r'|c|C) return 0 ;;
            ' ') index=$((row * ${#WORKERS[@]} + column)); [ -z "${CELLS[$index]}" ] || SELECTED[$index]=$((1 - SELECTED[index])) ;;
            r|R) toggle_row "$row" ;;
            a|A) select_all 1 ;;
            n|N) select_all 0 ;;
            $'\033')
                IFS= read -rsn 2 -t 1 arrow || continue
                case "$arrow" in
                    '[A'|'OA') row=$(((row + ${#CALLERS[@]} - 1) % ${#CALLERS[@]})) ;;
                    '[B'|'OB') row=$(((row + 1) % ${#CALLERS[@]})) ;;
                    '[C'|'OC') column=$(((column + 1) % ${#WORKERS[@]})) ;;
                    '[D'|'OD') column=$(((column + ${#WORKERS[@]} - 1) % ${#WORKERS[@]})) ;;
                esac
                ;;
        esac
    done
}
