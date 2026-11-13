#!/bin/bash
# Shared installation catalog. Order preserves the public menu numbers.
# Fields: provider | hosts | option | Codex profile | display name
INTEGRATIONS=(
    'codex|claude|--codex-mcp||Codex'
    'claude|codex|--claude-mcp||Claude'
    'rosalind|claude codex|--rosalind-mcp|rosalind_delegate|Rosalind'
    'codex|codex|--codex-from-codex||Codex'
    'agy|claude codex|--agy-mcp||Antigravity'
)

load_integration() {
    IFS='|' read -r INTEGRATION_PROVIDER INTEGRATION_HOSTS INTEGRATION_OPTION INTEGRATION_PROFILE INTEGRATION_LABEL \
        <<< "${INTEGRATIONS[$1]}"
    case "$INTEGRATION_HOSTS" in
        claude) INTEGRATION_HOST_LABEL="Claude Code" ;;
        codex) INTEGRATION_HOST_LABEL="Codex" ;;
        "claude codex") INTEGRATION_HOST_LABEL="Claude Code and Codex" ;;
    esac
}

server_entrypoint() {
    case "$1:$2" in
        codex:claude) printf 'mcp.js' ;;
        codex:codex) printf 'codexCodexMcp.js' ;;
        claude:codex) printf 'claudeMcp.js' ;;
        *:claude) printf '%sMcp.js' "$1" ;;
        *:codex) printf '%sCodexMcp.js' "$1" ;;
        *) return 1 ;;
    esac
}
