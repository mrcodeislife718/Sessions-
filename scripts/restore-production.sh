#!/usr/bin/env bash
set -euo pipefail

: "${RESTORE_DATABASE_URL:?RESTORE_DATABASE_URL is required}"
: "${BACKUP_FILE:?BACKUP_FILE is required}"
: "${SESSIONS_CONFIRM_RESTORE:?Set SESSIONS_CONFIRM_RESTORE=I_UNDERSTAND_THIS_REPLACES_DATABASE}"

if [[ "$SESSIONS_CONFIRM_RESTORE" != "I_UNDERSTAND_THIS_REPLACES_DATABASE" ]]; then
  echo "Restore confirmation value is incorrect." >&2
  exit 2
fi

if [[ ! -f "$BACKUP_FILE" ]]; then
  echo "Backup file not found: $BACKUP_FILE" >&2
  exit 2
fi

if [[ -f "$BACKUP_FILE.sha256" ]]; then
  (cd "$(dirname "$BACKUP_FILE")" && sha256sum -c "$(basename "$BACKUP_FILE.sha256")")
else
  echo "Warning: checksum file not found; refusing unverified restore." >&2
  exit 2
fi

pg_restore --clean --if-exists --no-owner --no-privileges --dbname="$RESTORE_DATABASE_URL" "$BACKUP_FILE"
psql "$RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "select count(*) from sessions" >/dev/null
psql "$RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "select count(*) from audit_events" >/dev/null

echo "Restore completed and core tables verified."
