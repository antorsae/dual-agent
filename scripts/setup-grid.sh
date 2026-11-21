#!/bin/bash
# Selection is stored per cell, for both interactive and unattended setup.
set_row() {
    local row="$1" value="$2" column index
    for column in "${!WORKERS[@]}"; do
        index=$((row * ${#WORKERS[@]} + column))
        [ -z "${CELLS[$index]}" ] || SELECTED[$index]="$value"
    done
}

select_for() {
    local spec="$1" target workers worker column index found
    local -a requested=()
    target="${spec%=*}"
    workers="${spec##*=}"
    if [ "$target" = "$spec" ] || [ -z "$target" ]; then fail "Invalid selection '$spec'. Use --for HOST[@HOME]=WORKER,WORKER."; fi
    case "$workers" in
        ''|,*|*,|*,,*) fail "Invalid selection '$spec'. Use --for HOST[@HOME]=WORKER,WORKER." ;;
    esac
    resolve_target "$target" || fail "Invalid selection '$spec'. Use --for HOST[@HOME]=WORKER,WORKER."
    IFS=',' read -r -a requested <<< "$workers"
    for worker in "${requested[@]}"; do
        found=0
        for column in "${!WORKERS[@]}"; do
            index=$((TARGET_ROW * ${#WORKERS[@]} + column))
            if [ "${CELLS[$index]}" = "${CALLERS[$TARGET_ROW]}=$worker" ]; then
                SELECTED[$index]=1
                found=1
                break
            fi
        done
        [ "$found" -eq 1 ] || fail "Unsupported caller/worker selection '$target=$worker'. See --help."
    done
    HOME_SELECTED[$TARGET_ROW]=1
    INSTALL_REQUESTED=1
}

worker_selected() {
    local index
    for index in "${!CELLS[@]}"; do
        if [ "${SELECTED[$index]}" -eq 1 ] && [ "${CELLS[$index]#*=}" = "$1" ]; then return 0; fi
    done
    return 1
}

render_grid() {
    local current_row="$1" current_col="$2" i row column index mark label part line style
    local name_width=$LABEL_WIDTH column_width=0
    local -a columns=("${!WORKERS[@]}")
    if [ "$PICKER_SCREEN" -eq 1 ]; then
        for label in "${WORKER_LABELS[@]}"; do column_width=$((column_width + 1 + ${#label})); done
        # On a narrow terminal, left/right still reaches every worker.
        if [ "$((PICKER_WIDTH - column_width))" -lt 12 ]; then
            columns=("$current_col")
            column_width=$((1 + ${#WORKER_LABELS[$current_col]}))
        fi
        if [ "$((name_width + column_width))" -gt "$PICKER_WIDTH" ]; then name_width=$((PICKER_WIDTH - column_width)); fi
        if [ "$name_width" -lt 1 ]; then name_width=1; fi
    fi
    picker_fit 'Caller / worker' "$name_width"
    printf -v line '%-*s' "$name_width" "$PICKER_TEXT"
    for column in "${columns[@]}"; do line+=" ${WORKER_LABELS[$column]}"; done
    picker_hint 1 "$line"
    for ((i=PICKER_FIRST; i<PICKER_END; i++)); do
        row="${GRID_ROWS[$i]}"
        picker_fit "${CALLER_LABELS[$row]}" "$name_width"
        printf -v line '%-*s' "$name_width" "$PICKER_TEXT"
        for column in "${columns[@]}"; do
            index=$((row * ${#WORKERS[@]} + column))
            if [ -z "${CELLS[$index]}" ]; then mark=' - '
            elif [ "${SELECTED[$index]}" -eq 1 ]; then mark='[x]'
            else mark='[ ]'; fi
            if [ "$row" -eq "$current_row" ] && [ "$column" -eq "$current_col" ]; then mark=">$mark"; else mark=" $mark"; fi
            label="${WORKER_LABELS[$column]}"
            printf -v part ' %-*s' "${#label}" "$mark"
            line+="$part"
        done
        style=""
        if [ "$row" -eq "$current_row" ]; then style=focus; fi
        picker_line "$line" "$style"
    done
}

toggle_row() {
    local row="$1" column index value=0
    for column in "${!WORKERS[@]}"; do
        index=$((row * ${#WORKERS[@]} + column))
        if [ -n "${CELLS[$index]}" ] && [ "${SELECTED[$index]}" -eq 0 ]; then value=1; break; fi
    done
    set_row "$row" "$value"
}

# Wrap between paths, and split an individual path only if it cannot fit on a line.
grid_path_lines() {
    local line="$1" path separator='   '
    shift
    for path in "$@"; do
        if [ "$((${#line} + ${#separator} + ${#path}))" -gt "$PICKER_WIDTH" ]; then
            GRID_HOME_HINTS+=("$line")
            line="  $path"
            while [ "${#line}" -gt "$PICKER_WIDTH" ]; do
                GRID_HOME_HINTS+=("${line:0:PICKER_WIDTH}")
                line="${line:PICKER_WIDTH}"
            done
        else
            line+="$separator$path"
        fi
        separator=', '
    done
    GRID_HOME_HINTS+=("$line")
}

grid_home_summary() {
    local caller row label
    local -a paths=()
    GRID_HOME_HINTS=()
    for caller in codex claude agy; do
        case "$caller" in
            codex) grid_path_lines "Codex and Rosalind worker home" "$ACTIVE_CODEX_HOME"; label="Selected Codex caller homes" ;;
            claude) grid_path_lines "Claude worker home" "$ACTIVE_CLAUDE_HOME"; label="Selected Claude caller homes" ;;
            agy) label="Selected AGY caller home" ;;
        esac
        paths=()
        for row in "${GRID_ROWS[@]}"; do
            [ "${CALLERS[$row]}" = "$caller" ] || continue
            paths+=("$(display_home_path "${CALLER_HOMES[$row]}")")
        done
        if [ "${#paths[@]}" -gt 0 ]; then grid_path_lines "$label" "${paths[@]}"; fi
    done
}

choose_from_grid() {
    local column=0 row other col index width count worker fixed_lines compact hint
    local -a GRID_HOME_HINTS=() worker_paths=()
    GRID_ROWS=()
    LABEL_WIDTH=16
    for row in "${HOME_ORDER[@]}"; do
        if [ "${HOME_SELECTED[$row]}" -eq 0 ]; then set_row "$row" 0; continue; fi
        GRID_ROWS+=("$row")
        width=${#CALLER_LABELS[$row]}
        if [ "$width" -gt "$LABEL_WIDTH" ]; then LABEL_WIDTH=$width; fi
    done
    count=${#GRID_ROWS[@]}
    [ "$count" -gt 0 ] || return 0
    for worker in "${WORKERS[@]}"; do worker_paths+=("$(display_home_path "$(active_home "$worker")")"); done
    picker_open
    while true; do
        row="${GRID_ROWS[$PICKER_ROW]}"
        if [ "$PICKER_RESIZED" -eq 1 ]; then
            picker_measure
            grid_home_summary
            fixed_lines=$((5 + ${#GRID_HOME_HINTS[@]}))
            compact=0
            if [ "$fixed_lines" -gt "$((PICKER_HEIGHT - 2))" ]; then compact=1; fixed_lines=7; fi
        fi
        picker_viewport "$count" "$fixed_lines"
        picker_hint 4 "Select workers for each caller home"
        picker_hint 2 "↑↓←→ move  Space toggle  Enter apply  q quit"
        picker_hint 5 "PgUp/Dn page   r row   p copy   a all   n clear"
        if [ "$compact" -eq 1 ]; then
            picker_hint 6 "Caller   ${CALLER_LABELS[$row]}"
            picker_hint 7 "Worker   ${WORKER_LABELS[$column]}  ${worker_paths[$column]}"
        else
            for hint in "${GRID_HOME_HINTS[@]}"; do picker_line "$hint"; done
        fi
        render_grid "$row" "$column"
        picker_hint 3 "Homes $((PICKER_FIRST + 1))–$PICKER_END of $count   ${WORKER_LABELS[$column]} worker"
        picker_read_key
        if picker_move "$count"; then continue; fi
        case "$PICKER_KEY" in
            enter|c|C) picker_close; return 0 ;;
            left) column=$(((column + ${#WORKERS[@]} - 1) % ${#WORKERS[@]})) ;;
            right) column=$(((column + 1) % ${#WORKERS[@]})) ;;
            space) index=$((row * ${#WORKERS[@]} + column)); [ -z "${CELLS[$index]}" ] || SELECTED[$index]=$((1 - SELECTED[index])) ;;
            r|R) toggle_row "$row" ;;
            a|A) for other in "${GRID_ROWS[@]}"; do set_row "$other" 1; done ;;
            n|N) for other in "${GRID_ROWS[@]}"; do set_row "$other" 0; done ;;
            p|P)
                for other in "${GRID_ROWS[@]}"; do
                    [ "${CALLERS[$other]}" = "${CALLERS[$row]}" ] || continue
                    for col in "${!WORKERS[@]}"; do
                        SELECTED[$((other * ${#WORKERS[@]} + col))]="${SELECTED[$((row * ${#WORKERS[@]} + col))]}"
                    done
                done ;;
        esac
    done
}
