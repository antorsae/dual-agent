#!/bin/bash
# Sourced after the installer's logging and registration helpers.

# Fill select_agy_model's AGY_PICK_ORDER with matching catalog indices in saved order.
agy_restore_order() {
    local csv="$1" id index
    shift
    local -a catalog_ids=("$@") requested=() seen=()
    AGY_PICK_ORDER=()
    [ -n "$csv" ] || return 0
    IFS=',' read -r -a requested <<< "$csv"
    for id in "${requested[@]}"; do
        for index in "${!catalog_ids[@]}"; do
            [ "${catalog_ids[$index]}" = "$id" ] || continue
            if [ "${seen[$index]:-0}" -eq 0 ]; then AGY_PICK_ORDER+=("$index"); seen[$index]=1; fi
            break
        done
    done
}

select_agy_model() {
    local catalog="${INSTALL_LOG}.agy-models" id label index normalized rank adjacent marker style
    local requested="${AGY_MODELS:-${AGY_MODEL:-}}" saved defaults selection notice="" count
    local policy="$SCRIPT_DIR/agent/src/agyModels.mjs"
    local -a ids=() labels=() AGY_PICK_ORDER=() ranks=()
    saved="$(saved_worker_env agy-delegate AGY_MODELS)"
    if [ -z "$saved" ]; then saved="$(saved_worker_env agy-delegate AGY_MODEL)"; fi
    if ! "$DELEGATE_AGY_BIN" models > "$catalog" 2>> "$INSTALL_LOG"; then
        fail "Could not list Antigravity models. Authenticate with agy and rerun setup."
    fi
    while IFS=$'\t' read -r id label || [ -n "$id" ]; do
        [[ "$id" =~ ^[A-Za-z0-9][A-Za-z0-9._:/-]*$ ]] && [ -n "$label" ] || continue
        ids+=("$id"); labels+=("$label")
    done < "$catalog"
    [ "${#ids[@]}" -gt 0 ] || fail "agy models returned no model IDs. Authenticate with agy and rerun setup."
    defaults="$(node "$policy" defaults "$catalog")"
    selection="${saved:-$defaults}"
    if [ -n "$requested" ]; then
        selection="$requested"
    elif [ "$INTERACTIVE_INSTALL" -eq 1 ] || [ -t 0 ]; then
        count=${#ids[@]}
        agy_restore_order "$selection" "${ids[@]}"
        picker_open
        while true; do
            ranks=()
            for rank in "${!AGY_PICK_ORDER[@]}"; do
                index=${AGY_PICK_ORDER[$rank]}
                ranks[$index]=$((rank + 1))
            done
            picker_frame "$count" 4
            picker_hint 2 "Choose the Antigravity model priority. [1] runs first."
            picker_hint 1 "↑↓ move   Space toggle   Enter use order   q quit"
            picker_hint 4 "← earlier   → later   d default   n clear"
            for ((index=PICKER_FIRST; index<PICKER_END; index++)); do
                marker=' '; style=''
                if [ "$index" -eq "$PICKER_ROW" ]; then marker='>'; style=focus; fi
                picker_line "$marker [${ranks[$index]:- }] ${labels[$index]} (${ids[$index]})" "$style"
            done
            picker_hint 3 "${notice:-${#AGY_PICK_ORDER[@]} selected   Models $((PICKER_FIRST + 1))–$PICKER_END of $count}"
            notice=""
            picker_read_key
            if [ "$PICKER_KEY" = cancel ]; then rm -f "$catalog"; fi
            if picker_move "$count"; then continue; fi
            rank=$((${ranks[$PICKER_ROW]:-0} - 1))
            case "$PICKER_KEY" in
                enter)
                    if [ "${#AGY_PICK_ORDER[@]}" -gt 0 ]; then break; fi
                    notice="Select at least one model with Space." ;;
                space)
                    if [ "$rank" -lt 0 ]; then AGY_PICK_ORDER+=("$PICKER_ROW")
                    else AGY_PICK_ORDER=("${AGY_PICK_ORDER[@]:0:rank}" "${AGY_PICK_ORDER[@]:rank+1}"); fi ;;
                left|right)
                    if [ "$rank" -lt 0 ]; then notice="Press Space to add this model to the order."; continue; fi
                    if [ "$PICKER_KEY" = left ]; then adjacent=$((rank - 1)); else adjacent=$((rank + 1)); fi
                    if [ "$adjacent" -ge 0 ] && [ "$adjacent" -lt "${#AGY_PICK_ORDER[@]}" ]; then
                        AGY_PICK_ORDER[$rank]="${AGY_PICK_ORDER[$adjacent]}"
                        AGY_PICK_ORDER[$adjacent]=$PICKER_ROW
                    fi ;;
                n|N) AGY_PICK_ORDER=() ;;
                d|D) agy_restore_order "$defaults" "${ids[@]}" ;;
                [0-9])
                    picker_prompt "Catalog numbers in priority order: $PICKER_KEY"
                    if picker_number_list "$PICKER_KEY$PICKER_INPUT" "$count"; then
                        AGY_PICK_ORDER=("${PICKER_NUMBERS[@]}"); break
                    fi
                    notice="Choose a model number from the list, or several numbers in priority order." ;;
            esac
        done
        picker_close
        selection=""
        for index in "${AGY_PICK_ORDER[@]}"; do selection+="${selection:+,}${ids[$index]}"; done
    fi
    [ -n "$selection" ] || fail "No default models are available. Select models with --agy-models ID,ID or AGY_MODELS."
    if ! normalized="$(node "$policy" validate "$selection" "$catalog")"; then
        fail "Invalid Antigravity model priority list. Run agy models and select available IDs."
    fi
    rm -f "$catalog"
    DELEGATE_AGY_MODELS="$normalized"
    DELEGATE_AGY_MODEL="${normalized%%,*}"
    echo "  Antigravity model priority: $DELEGATE_AGY_MODELS"
}

verify_agy_model() {
    local result="${INSTALL_LOG}.agy-result" errors="${INSTALL_LOG}.agy-errors" status model
    local -a models=()
    IFS=',' read -r -a models <<< "$DELEGATE_AGY_MODELS"
    for model in "${models[@]}"; do
        status=0
        "$DELEGATE_AGY_BIN" --print="Do not use tools. Reply with exactly: DUAL_AGENT_PROFILE_OK" \
            --model "$model" --output-format json --disable-slash-commands \
            --settings '{"agentMode":"","toolPermission":"request-review","permissions":{"allow":[],"ask":[],"deny":["write_file(*)","command(*)","mcp(*)","execute_url(*)"]}}' > "$result" 2> "$errors" || status=$?
        if node "$SCRIPT_DIR/agent/src/agyModels.mjs" check "$result" "$errors" "$status"; then
            rm -f "$result" "$errors"
            return 0
        else
            status=$?
        fi
        cat "$errors"
        rm -f "$result" "$errors"
        [ "$status" -eq 75 ] || return "$status"
        echo "  Quota exhausted for $model; checking the next configured model."
    done
    echo "All configured Antigravity models are quota/rate limited." >&2
    return 1
}
