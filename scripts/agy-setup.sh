#!/bin/bash
# Sourced after the installer's logging and registration helpers.
select_agy_model() {
    local catalog="${INSTALL_LOG}.agy-models" id label choice index default_index=""
    local requested="${AGY_MODEL:-}" saved native_default
    local -a ids=() labels=()
    saved="$(codex_registration_env agy-delegate AGY_MODEL)"
    native_default="$(node -e 'try { console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).model || ""); } catch {}' "$HOME/.gemini/antigravity-cli/settings.json")"
    if ! "$DELEGATE_AGY_BIN" models > "$catalog" 2>> "$INSTALL_LOG"; then
        fail "Could not list Antigravity models. Authenticate with agy and rerun setup."
    fi
    while IFS=$'\t' read -r id label || [ -n "$id" ]; do
        [[ "$id" =~ ^[A-Za-z0-9][A-Za-z0-9._:/-]*$ ]] && [ -n "$label" ] || continue
        ids+=("$id"); labels+=("$label")
    done < "$catalog"
    rm -f "$catalog"
    [ "${#ids[@]}" -gt 0 ] || fail "agy models returned no model IDs. Authenticate with agy and rerun setup."
    if [ -n "$requested" ]; then
        DELEGATE_AGY_MODEL="$requested"
    elif [ "$INTERACTIVE_INSTALL" -eq 1 ] || [ -t 0 ]; then
        echo "Choose the Antigravity model for agy-delegate:"
        for index in "${!ids[@]}"; do
            printf '  %s) %s (%s)\n' "$((index + 1))" "${labels[$index]}" "${ids[$index]}"
            if [ "${ids[$index]}" = "$saved" ] || { [ -z "$saved" ] && [ "${labels[$index]}" = "$native_default" ]; }; then
                default_index=$((index + 1))
            fi
        done
        while true; do
            printf 'Model number%s: ' "${default_index:+ [default: $default_index]}"
            if ! read -r choice; then fail "No model selected. Set AGY_MODEL or pass --agy-model MODEL for unattended setup."; fi
            choice="${choice:-$default_index}"
            if [[ "$choice" =~ ^[0-9]+$ ]] && [ "${#choice}" -le 3 ] && [ "$((10#$choice))" -ge 1 ] && [ "$((10#$choice))" -le "${#ids[@]}" ]; then
                DELEGATE_AGY_MODEL="${ids[$((10#$choice - 1))]}"
                break
            fi
            echo "Choose a model number from the list."
        done
    else
        DELEGATE_AGY_MODEL="$saved"
        [ -n "$DELEGATE_AGY_MODEL" ] || fail "Select an Antigravity model with --agy-model MODEL or AGY_MODEL for unattended setup. Run agy models to list IDs."
    fi
    for id in "${ids[@]}"; do
        if [ "$id" = "$DELEGATE_AGY_MODEL" ]; then
            echo "  Antigravity model: $DELEGATE_AGY_MODEL"
            return 0
        fi
    done
    fail "Antigravity model is unavailable: $DELEGATE_AGY_MODEL. Run agy models and select an available ID."
}

verify_agy_model() {
    local result="${INSTALL_LOG}.agy-result" status=0
    "$DELEGATE_AGY_BIN" --print="Do not use tools. Reply with exactly: DUAL_AGENT_PROFILE_OK" \
        --model "$DELEGATE_AGY_MODEL" --output-format json --disable-slash-commands \
        --settings '{"agentMode":"","toolPermission":"request-review","permissions":{"allow":[],"ask":[],"deny":["write_file(*)","command(*)","mcp(*)","execute_url(*)"]}}' > "$result" || status=$?
    if [ "$status" -eq 0 ]; then
        node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); if(r.status !== "SUCCESS" || r.error || r.response?.trim() !== "DUAL_AGENT_PROFILE_OK") { console.error("Antigravity verification failed:", r.error || r.status); process.exit(1); }' "$result" || status=$?
    fi
    rm -f "$result"
    return "$status"
}
