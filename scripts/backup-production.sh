#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${SESSIONS_BACKUP_DIR:=./backups}"

mkdir -p "$SESSIONS_BACKUP_DIR"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup="$SESSIONS_BACKUP_DIR/sessions-$timestamp.dump"
manifest="$backup.sha256"

umask 077
pg_dump "$DATABASE_URL" --format=custom --no-owner --no-privileges --file="$backup"
sha256sum "$backup" > "$manifest"

printf '%s\n' "Backup created: $backup" "Checksum: $manifest"
