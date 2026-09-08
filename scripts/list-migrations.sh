#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
shopt -s nullglob
printf '%s\n' "$root/infrastructure/postgres/init.sql"
migrations=("$root"/infrastructure/postgres/[0-9][0-9][0-9]-*.sql)
printf '%s\n' "${migrations[@]}"
