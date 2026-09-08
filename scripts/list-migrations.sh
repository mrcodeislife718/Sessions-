#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
printf '%s\n' "$root/infrastructure/postgres/init.sql"
find "$root/infrastructure/postgres" -maxdepth 1 -type f -regextype posix-extended -regex '.*/[0-9]{3}-[^/]+\.sql' -print | LC_ALL=C sort
