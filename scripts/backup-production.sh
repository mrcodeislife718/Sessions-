#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${SESSIONS_BACKUP_DIR:=./backups}"

mkdir -p "$SESSIONS_BACKUP_DIR"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup="$SESSIONS_BACKUP_DIR/sessions-$timestamp.dump"
manifest="$backup.sha256"
umask 077

server_major="$(psql "$DATABASE_URL" -Atc "show server_version_num" | awk '{print int($1/10000)}')"
client_major="$(pg_dump --version | awk '{print $NF}' | cut -d. -f1)"

if [[ "$server_major" == "$client_major" ]]; then
  pg_dump "$DATABASE_URL" --format=custom --no-owner --no-privileges --file="$backup"
elif command -v docker >/dev/null 2>&1; then
  dir="$(cd "$(dirname "$backup")" && pwd)"
  file="$(basename "$backup")"
  docker run --rm --network host -e PGPASSWORD="${PGPASSWORD:-}" -v "$dir:/backup" "postgres:${server_major}" \
    pg_dump "$DATABASE_URL" --format=custom --no-owner --no-privileges --file="/backup/$file"
else
  echo "PostgreSQL client/server major mismatch ($client_major/$server_major) and Docker is unavailable." >&2
  exit 1
fi

sha256sum "$backup" > "$manifest"
printf '%s\n' "Backup created: $backup" "Checksum: $manifest" "PostgreSQL major: $server_major"
