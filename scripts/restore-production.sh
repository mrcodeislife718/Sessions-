#!/usr/bin/env bash
set -euo pipefail

: "${RESTORE_DATABASE_URL:?RESTORE_DATABASE_URL is required}"
: "${BACKUP_FILE:?BACKUP_FILE is required}"
: "${SESSIONS_CONFIRM_RESTORE:?Set SESSIONS_CONFIRM_RESTORE=I_UNDERSTAND_THIS_REPLACES_DATABASE}"

if [[ "$SESSIONS_CONFIRM_RESTORE" != "I_UNDERSTAND_THIS_REPLACES_DATABASE" ]]; then
  echo "Restore confirmation value is incorrect." >&2
  exit 2
fi
if [[ ! -f "$BACKUP_FILE" ]]; then echo "Backup file not found: $BACKUP_FILE" >&2; exit 2; fi
if [[ -f "$BACKUP_FILE.sha256" ]]; then
  (cd "$(dirname "$BACKUP_FILE")" && sha256sum -c "$(basename "$BACKUP_FILE.sha256")")
else
  echo "Checksum file not found; refusing unverified restore." >&2
  exit 2
fi

server_major="$(psql "$RESTORE_DATABASE_URL" -Atc "show server_version_num" | awk '{print int($1/10000)}')"
client_major="$(pg_restore --version | awk '{print $NF}' | cut -d. -f1)"
if [[ "$server_major" == "$client_major" ]]; then
  pg_restore --clean --if-exists --no-owner --no-privileges --dbname="$RESTORE_DATABASE_URL" "$BACKUP_FILE"
elif command -v docker >/dev/null 2>&1; then
  dir="$(cd "$(dirname "$BACKUP_FILE")" && pwd)"
  file="$(basename "$BACKUP_FILE")"
  docker run --rm --network host -e PGPASSWORD="${PGPASSWORD:-}" -v "$dir:/backup:ro" "postgres:${server_major}" \
    pg_restore --clean --if-exists --no-owner --no-privileges --dbname="$RESTORE_DATABASE_URL" "/backup/$file"
else
  echo "PostgreSQL client/server major mismatch ($client_major/$server_major) and Docker is unavailable." >&2
  exit 1
fi

psql "$RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "select count(*) from sessions" >/dev/null
psql "$RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "select count(*) from audit_events" >/dev/null
psql "$RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "select count(*) from product_events" >/dev/null

echo "Restore completed and core operational tables verified."
