#!/usr/bin/env bash
set -euo pipefail
: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${POSTGRES_DB:?POSTGRES_DB is required}"
root=/sessions-migrations
psql_args=(--username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -v ON_ERROR_STOP=1)
psql "${psql_args[@]}" -f "$root/init.sql"
shopt -s nullglob
migrations=("$root"/[0-9][0-9][0-9]-*.sql)
for migration in "${migrations[@]}"; do
  echo "[sessions-postgres-init] applying $(basename "$migration")"
  psql "${psql_args[@]}" -f "$migration"
done
