#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   ACCESS_KEY_ID=AK_xxx ACCESS_SECRET=SK_xxx BASE_URL=https://api.example.com ./scripts/demo.sh
# Optional envs:
#   ACTIVITY_TYPE=call ACTIVITY_DIRECTION=outbound ACTIVITY_USER_ID=user123 ACTIVITY_SUMMARY="..." ACTIVITY_AT=<iso> ACTIVITY_ID=<id> ACTIVITY_NEXT_FOLLOW_UP_AT=<iso> ACTIVITY_LEAD_ID=<id> VERBOSE=true
NODE_TLS_REJECT_UNAUTHORIZED=0

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

: "${ACCESS_KEY_ID:?ACCESS_KEY_ID is required}"
: "${ACCESS_SECRET:?ACCESS_SECRET is required}"
BASE_URL="${BASE_URL:-https://api.suremate.local:5000}"
ACTIVITY_TYPE="${ACTIVITY_TYPE:-call}"
ACTIVITY_DIRECTION="${ACTIVITY_DIRECTION:-outbound}"
ACTIVITY_USER_ID="${ACTIVITY_USER_ID:-demo-user}"
ACTIVITY_SUMMARY="${ACTIVITY_SUMMARY:-Demo activity created from CLI demo.sh}"
ACTIVITY_AT="${ACTIVITY_AT:-$(date -u +"%Y-%m-%dT%H:%M:%SZ")}"

ARGS=(
  "--access-key-id" "${ACCESS_KEY_ID}"
  "--access-secret" "${ACCESS_SECRET}"
  "--base-url" "${BASE_URL}"
)

if [[ "${VERBOSE:-}" =~ ^(1|true|yes)$ ]]; then
  ARGS+=("--verbose")
fi

ARGS+=(
  "create-activity"
  "--type" "${ACTIVITY_TYPE}"
  "--direction" "${ACTIVITY_DIRECTION}"
  "--user-id" "${ACTIVITY_USER_ID}"
  "--summary" "${ACTIVITY_SUMMARY}"
  "--at" "${ACTIVITY_AT}"
)

if [[ -n "${ACTIVITY_ID:-}" ]]; then
  ARGS+=("--id" "${ACTIVITY_ID}")
fi

if [[ -n "${ACTIVITY_NEXT_FOLLOW_UP_AT:-}" ]]; then
  ARGS+=("--next-follow-up-at" "${ACTIVITY_NEXT_FOLLOW_UP_AT}")
fi

if [[ -n "${ACTIVITY_LEAD_ID:-}" ]]; then
  ARGS+=("--lead-id" "${ACTIVITY_LEAD_ID}")
fi

cd "${REPO_ROOT}"
exec "${BUN_BIN:-bun}" run src/cli.ts "${ARGS[@]}"
