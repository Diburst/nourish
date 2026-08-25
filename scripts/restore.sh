#!/bin/sh
# Restore a chosen dump into the running db container.
# Usage: docker compose stop app && sh scripts/restore.sh backups/<file>.sql.gz && docker compose start app
set -eu

FILE="${1:?Usage: sh scripts/restore.sh backups/<file>.sql.gz}"
[ -f "$FILE" ] || { echo "No such file: $FILE" >&2; exit 1; }

echo "[restore] dropping and recreating database nourish"
docker compose exec -T db psql -U nourish -d postgres -c "DROP DATABASE IF EXISTS nourish;"
docker compose exec -T db psql -U nourish -d postgres -c "CREATE DATABASE nourish;"

echo "[restore] loading $FILE"
gunzip -c "$FILE" | docker compose exec -T db psql -U nourish -d nourish

echo "[restore] done — start the app again with: docker compose start app"
