#!/bin/bash
# Shared keyboard navigation and scrolling for the home list and worker grid.
picker_open() {
    PICKER_SCREEN=0
    PICKER_ROW=0
    PICKER_FIRST=0
    PICKER_RESIZED=1
    if [ -t 0 ] && [ -t 1 ] && [ "${TERM:-}" != dumb ]; then
        PICKER_SCREEN=1
        trap 'picker_close' EXIT
        trap 'exit 130' INT
        trap 'exit 143' TERM
        trap 'exit 129' HUP
        trap 'PICKER_RESIZED=1' WINCH
        printf '\033[?1049h\033[?25l'
    fi
}

picker_close() {
    if [ "$PICKER_SCREEN" -eq 1 ]; then
        PICKER_SCREEN=0
        printf '\033[0m\033[?25h\033[?1049l'
        trap - EXIT INT TERM HUP WINCH
    fi
}

picker_measure() {
    local height="${LINES:-24}" width="${COLUMNS:-80}" size
    [ "$PICKER_RESIZED" -eq 1 ] || return 0
    PICKER_RESIZED=0
    if [ "$PICKER_SCREEN" -eq 1 ] && size="$(stty size 2>/dev/null)"; then read -r height width <<< "$size"; fi
    [[ "$height" =~ ^[1-9][0-9]{0,4}$ ]] || height=24
    [[ "$width" =~ ^[1-9][0-9]{0,4}$ ]] || width=80
    PICKER_HEIGHT=$height
    PICKER_WIDTH=$width
    if [ "$PICKER_SCREEN" -eq 1 ] && [ "$width" -gt 1 ]; then PICKER_WIDTH=$((width - 1)); fi
}

picker_frame() {
    picker_measure
    picker_viewport "$@"
}

# Leave one terminal line below the frame so the final newline cannot scroll it.
picker_viewport() {
    local count="$1"
    PICKER_OUTPUT=""
    PICKER_FIXED=$2
    if [ "$PICKER_FIXED" -gt "$((PICKER_HEIGHT - 2))" ]; then PICKER_FIXED=$((PICKER_HEIGHT - 2)); fi
    if [ "$PICKER_FIXED" -lt 0 ]; then PICKER_FIXED=0; fi
    PICKER_PAGE=$((PICKER_HEIGHT - PICKER_FIXED - 1))
    if [ "$PICKER_PAGE" -lt 1 ]; then PICKER_PAGE=1; fi
    if [ "$PICKER_PAGE" -gt "$count" ]; then PICKER_PAGE=$count; fi
    if [ "$PICKER_ROW" -lt "$PICKER_FIRST" ]; then PICKER_FIRST=$PICKER_ROW; fi
    if [ "$PICKER_ROW" -ge "$((PICKER_FIRST + PICKER_PAGE))" ]; then PICKER_FIRST=$((PICKER_ROW - PICKER_PAGE + 1)); fi
    if [ "$PICKER_FIRST" -gt "$((count - PICKER_PAGE))" ]; then PICKER_FIRST=$((count - PICKER_PAGE)); fi
    PICKER_END=$((PICKER_FIRST + PICKER_PAGE))
}

# Keep both the caller name and the distinctive end of a long home path visible.
picker_fit() {
    local value="$1" width="$2" tail
    PICKER_TEXT="$value"
    if [ "${#value}" -le "$width" ]; then return; fi
    if [ "$width" -le 3 ]; then PICKER_TEXT="${value:0:width}"; return; fi
    tail=$(((width - 3) / 2))
    PICKER_TEXT="${value:0:width-3-tail}...${value:${#value}-tail}"
}

picker_line() {
    local value="${1//[[:cntrl:]]/?}"
    if [ "$PICKER_SCREEN" -eq 1 ]; then
        picker_fit "$value" "$PICKER_WIDTH"
        if [ "${2:-}" = focus ]; then PICKER_OUTPUT+=$'\033[7m'"$PICKER_TEXT"$'\033[0m'
        else PICKER_OUTPUT+="$PICKER_TEXT"; fi
        PICKER_OUTPUT+=$'\033[K\r\n'
    else
        printf '%s\n' "$value"
    fi
}

# On short screens, reserve space for the focused item and keep the highest
# priority hints (1 first). Full-size screens show them in their normal order.
picker_hint() {
    if [ "$1" -le "$PICKER_FIXED" ]; then picker_line "$2"; fi
}

picker_prompt() {
    local partial=""
    if [ "$PICKER_SCREEN" -eq 1 ]; then printf '\033[?25h'; fi
    printf '%s' "$1"
    while true; do
        PICKER_RESIZED=0
        if IFS= read -r PICKER_INPUT; then PICKER_INPUT="$partial$PICKER_INPUT"; break; fi
        if [ "$PICKER_RESIZED" -eq 1 ]; then partial+="$PICKER_INPUT"; continue; fi
        picker_close
        fail "No input received. Use --help for unattended options."
    done
    PICKER_RESIZED=1
    if [ "$PICKER_SCREEN" -eq 1 ]; then printf '\033[?25l'; else printf '\n'; fi
}

# Older scripted menus supply one-based numbers. Keep their order and ignore repeats.
picker_number_list() {
    local input="${1// /}" count="$2" number index max_digits
    local -a numbers=() seen=()
    PICKER_NUMBERS=()
    [[ "$input" =~ ^[0-9]+(,[0-9]+)*$ ]] || return 1
    max_digits=${#count}
    if [ "$max_digits" -lt 3 ]; then max_digits=3; fi
    IFS=',' read -r -a numbers <<< "$input"
    for number in "${numbers[@]}"; do
        [ "${#number}" -le "$max_digits" ] || return 1
        index=$((10#$number - 1))
        if [ "$index" -lt 0 ] || [ "$index" -ge "$count" ]; then return 1; fi
        [ "${seen[$index]:-0}" -eq 0 ] || continue
        seen[$index]=1
        PICKER_NUMBERS+=("$index")
    done
}

picker_read_key() {
    local LC_ALL=C byte prefix sequence=""
    if [ "$PICKER_SCREEN" -eq 1 ]; then printf '\033[H%s\033[J' "$PICKER_OUTPUT"; fi
    PICKER_KEY=resize
    [ "$PICKER_RESIZED" -eq 0 ] || return 0
    if ! IFS= read -rsn 1 byte; then
        [ "$PICKER_RESIZED" -eq 1 ] && return 0
        picker_close
        fail "No selection received. Use --help for unattended options."
    fi
    case "$byte" in
        ''|$'\r') PICKER_KEY=enter ;;
        ' ') PICKER_KEY=space ;;
        q|Q|$'\003'|$'\004') PICKER_KEY=cancel ;;
        $'\033')
            PICKER_KEY=ignore
            if ! IFS= read -rsn 1 -t 1 prefix; then
                if [ "$PICKER_RESIZED" -eq 1 ]; then PICKER_KEY=resize; else PICKER_KEY=cancel; fi
                return 0
            fi
            [[ "$prefix" == '[' || "$prefix" == O ]] || return 0
            # Consume the entire CSI/SS3 sequence, including any modifiers.
            while IFS= read -rsn 1 -t 1 byte; do
                sequence+="$byte"
                case "$byte" in [@-~]) break ;; esac
            done
            case "$sequence" in
                *A) PICKER_KEY=up ;;   *B) PICKER_KEY=down ;;
                *C) PICKER_KEY=right ;; *D) PICKER_KEY=left ;;
                *H|'1~'|'7~') PICKER_KEY=first ;; *F|'4~'|'8~') PICKER_KEY=last ;;
                '5~') PICKER_KEY=page_up ;; '6~') PICKER_KEY=page_down ;;
            esac ;;
        *) PICKER_KEY="$byte" ;;
    esac
}

picker_move() {
    local count="$1"
    case "$PICKER_KEY" in
        up) PICKER_ROW=$(((PICKER_ROW + count - 1) % count)) ;;
        down) PICKER_ROW=$(((PICKER_ROW + 1) % count)) ;;
        first) PICKER_ROW=0 ;;
        last) PICKER_ROW=$((count - 1)) ;;
        page_up)
            PICKER_FIRST=$((PICKER_FIRST - PICKER_PAGE))
            PICKER_ROW=$((PICKER_ROW - PICKER_PAGE))
            if [ "$PICKER_FIRST" -lt 0 ]; then PICKER_FIRST=0; fi
            if [ "$PICKER_ROW" -lt 0 ]; then PICKER_ROW=0; fi ;;
        page_down)
            PICKER_FIRST=$((PICKER_FIRST + PICKER_PAGE))
            PICKER_ROW=$((PICKER_ROW + PICKER_PAGE))
            if [ "$PICKER_ROW" -ge "$count" ]; then PICKER_ROW=$((count - 1)); fi ;;
        cancel) picker_close; echo "Selection cancelled."; exit 0 ;;
        *) return 1 ;;
    esac
}
