#!/bin/sh
# Nightly pg_dump with retention. Runs inside the backup sidecar (postgres:16-alpine),
# and the same file format is produced by the Admin "Backup now" button in the app.
set -eu

HOST="${PGHOST:-db}"
USER="${PGUSER:-nourish}"
DB="${PGDATABASE:-nourish}"
DIR="${BACKUP_DIR:-/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

mkdir -p "$DIR"
STAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
FILE="$DIR/nourish-$STAMP.sql.gz"

echo "[backup] dumping $DB to $FILE"
pg_dump -h "$HOST" -U "$USER" --no-owner --no-privileges "$DB" | gzip > "$FILE"
echo "[backup] done: $(du -h "$FILE" | cut -f1)"

# Retention: delete dumps older than RETENTION_DAYS.
find "$DIR" -name 'nourish-*.sql.gz' -mtime "+$RETENTION_DAYS" -delete
echo "[backup] retention: kept dumps newer than $RETENTION_DAYS days"
