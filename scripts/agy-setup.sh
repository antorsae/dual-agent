#!/bin/bash
# Sourced after the installer's logging and registration helpers.
select_agy_model() {
    local catalog="${INSTALL_LOG}.agy-models" id label choice index number normalized
    local requested="${AGY_MODELS:-${AGY_MODEL:-}}" saved defaults selection default_numbers=""
    local policy="$SCRIPT_DIR/agent/src/agyModels.mjs"
    local -a ids=() labels=() selected=() numbers=()
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
        echo "Choose the Antigravity model priority list for agy-delegate:"
        echo "Default order: Hydrogen XHigh > Argon High > Opus 5.5 High (available models only)."
        for index in "${!ids[@]}"; do
            printf '  %s) %s (%s)\n' "$((index + 1))" "${labels[$index]}" "${ids[$index]}"
        done
        IFS=',' read -r -a selected <<< "$selection"
        for id in "${selected[@]}"; do
            for index in "${!ids[@]}"; do
                if [ "$id" = "${ids[$index]}" ]; then default_numbers+="${default_numbers:+,}$((index + 1))"; fi
            done
        done
        while true; do
            printf 'Model numbers in priority order, comma-separated%s (d = default order): ' "${default_numbers:+ [Enter: $default_numbers]}"
            if ! read -r choice; then fail "No models selected. Set AGY_MODELS or pass --agy-models ID,ID for unattended setup."; fi
            if [ "$choice" = d ] || [ "$choice" = D ]; then
                selection="$defaults"
            else
                choice="${choice:-$default_numbers}"
                choice="${choice// /}"
                selection=""
                if [[ "$choice" =~ ^[0-9]+(,[0-9]+)*$ ]]; then
                    IFS=',' read -r -a numbers <<< "$choice"
                    for number in "${numbers[@]}"; do
                        if [ "${#number}" -gt 3 ] || [ "$((10#$number))" -lt 1 ] || [ "$((10#$number))" -gt "${#ids[@]}" ]; then selection=""; break; fi
                        selection+="${selection:+,}${ids[$((10#$number - 1))]}"
                    done
                fi
            fi
            [ -n "$selection" ] && break
            echo "Choose a model number from the list, or several numbers in priority order."
        done
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
