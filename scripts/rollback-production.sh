#!/usr/bin/env bash
set -euo pipefail

compose=(docker compose -f docker-compose.production.yml)
: "${SESSIONS_DOMAIN:?SESSIONS_DOMAIN is required}"
: "${ROLLBACK_REF:?ROLLBACK_REF must name a previously qualified git ref}"

current_ref="$(git rev-parse --short=12 HEAD)"
if ! git cat-file -e "${ROLLBACK_REF}^{commit}" 2>/dev/null; then
  echo "Unknown rollback ref: $ROLLBACK_REF" >&2
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree is dirty; refusing rollback." >&2
  exit 1
fi

echo "[sessions] backing up database before rollback from $current_ref"
bash scripts/backup-production.sh

echo "[sessions] checking out qualified rollback ref $ROLLBACK_REF"
git checkout --detach "$ROLLBACK_REF"
bash scripts/validate-production-config.sh
"${compose[@]}" build api billing web runner
"${compose[@]}" up -d --no-deps api billing runner web proxy

for i in $(seq 1 60); do
  api_ok=0
  if curl --fail --silent --show-error "https://${SESSIONS_DOMAIN}/ready" >/dev/null; then api_ok=1; fi
  billing_code="$(curl -s -o /dev/null -w '%{http_code}' "https://${SESSIONS_DOMAIN}/api/billing/subscription" || true)"
  if [[ "$api_ok" == 1 && ( "$billing_code" == 200 || "$billing_code" == 401 || "$billing_code" == 403 ) ]]; then
    printf '%s\n' "$ROLLBACK_REF" > .sessions-last-good-release
    echo "[sessions] rollback healthy: $ROLLBACK_REF"
    exit 0
  fi
  sleep 2
done

echo "[sessions] rollback ref failed readiness; manual incident response required" >&2
"${compose[@]}" ps >&2
exit 1
