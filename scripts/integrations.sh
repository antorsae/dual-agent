#!/bin/bash
# Each caller home gets a row in this worker order.
WORKERS=(codex claude rosalind agy)
WORKER_LABELS=(Codex Claude Rosalind Antigravity)
WORKER_PROFILES=('' '' rosalind_delegate '')

load_cell() {
    local index="$1"
    local row=$((index / ${#WORKERS[@]})) column=$((index % ${#WORKERS[@]}))
    INTEGRATION_HOST="${CALLERS[$row]}"
    INTEGRATION_HOST_LABEL="${CALLER_LABELS[$row]}"
    INTEGRATION_HOME="${CALLER_HOMES[$row]}"
    INTEGRATION_PROVIDER="${WORKERS[$column]}"
    INTEGRATION_LABEL="${WORKER_LABELS[$column]}"
    INTEGRATION_PROFILE="${WORKER_PROFILES[$column]}"
}

server_entrypoint() {
    case "$1:$2" in
        *:agy) printf 'reviewMcp.js' ;;
        codex:claude) printf 'mcp.js' ;;
        codex:codex) printf 'codexCodexMcp.js' ;;
        claude:codex) printf 'claudeMcp.js' ;;
        *:claude) printf '%sMcp.js' "$1" ;;
        *:codex) printf '%sCodexMcp.js' "$1" ;;
        *) return 1 ;;
    esac
}
