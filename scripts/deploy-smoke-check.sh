#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-}"
ALLOWED_CODES="${2:-200}"

if [[ -z "$BASE_URL" ]]; then
  echo "Usage: $0 <base-url> [allowed-status-codes]"
  echo "Example: $0 https://website.example.com 200"
  echo "Example (Preview auth): $0 https://website-preview.vercel.app 200,401"
  exit 1
fi

BASE_URL="${BASE_URL%/}"

echo "Smoke-check against: $BASE_URL"
echo "Allowed status codes: $ALLOWED_CODES"

HEALTH_CODE="$(curl -sS -o /dev/null -w "%{http_code}" "$BASE_URL/health")"
READY_CODE="$(curl -sS -o /dev/null -w "%{http_code}" "$BASE_URL/ready")"

contains_code() {
  local code="$1"
  local csv="$2"
  [[ ",$csv," == *",$code,"* ]]
}

if ! contains_code "$HEALTH_CODE" "$ALLOWED_CODES"; then
  echo "Health check failed: /health returned $HEALTH_CODE"
  exit 1
fi

if ! contains_code "$READY_CODE" "$ALLOWED_CODES"; then
  echo "Readiness check failed: /ready returned $READY_CODE"
  exit 1
fi

echo "Smoke-check passed: /health=$HEALTH_CODE and /ready=$READY_CODE."
