#!/bin/bash
set -euo pipefail
if [ "$(id -u)" = 0 ]; then exec gosu postgres "$0" "$@"; fi
# WAL and data share this volume. Alert before storage exhaustion stops writes.
df -Pk "$PGDATA" | awk 'NR == 2 {
  used = $5 + 0;
  printf "{\"disk_used_percent\":%d,\"disk_available_kib\":%d}\n", used, $4;
  if (used >= 85) { print "PostgreSQL volume is at least 85% full" > "/dev/stderr"; exit 1 }
}'
# Inspect the repository itself rather than trusting a local success marker.
inventory=$(pgbackrest --stanza=zoen --output=json info | jq -e '
  .[0] as $stanza |
  ($stanza.backup // [] | map(.timestamp.stop) | max // 0) as $last |
  ($stanza.backup // [] | map(.timestamp.start) | min // 0) as $oldest |
  {ok: ($stanza.status.code == 0 and (now - $last) < 9000 and $oldest > 0 and $oldest <= $last),
   last_backup_epoch: $last, backup_count: ($stanza.backup | length),
   oldest_backup_start_epoch: $oldest} |
  if .ok then . else error("PostgreSQL backup missing or older than 150 minutes") end')
printf '%s\n' "$inventory"
psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -At <<'SQL'
SELECT json_build_object('archive_mode', current_setting('archive_mode'),
  'archived_count', archived_count,
  'archive_healthy', archived_count > 0 AND
    (last_failed_time IS NULL OR last_archived_time >= last_failed_time))
FROM pg_stat_archiver;
SELECT CASE WHEN current_setting('archive_mode') = 'on' AND archived_count > 0
  AND (last_failed_time IS NULL OR last_archived_time >= last_failed_time)
  THEN 1 ELSE 1 / (archived_count - archived_count) END FROM pg_stat_archiver;
SQL

# The application can read this receipt but cannot choose a retention floor.
# During the first storage migration this table does not exist yet.
oldest=$(jq -er '.oldest_backup_start_epoch' <<<"$inventory")
psql -X -U postgres -d "${POSTGRES_DB:?Application database is required}" \
  -v ON_ERROR_STOP=1 -v oldest="$oldest" -At <<'SQL'
SELECT to_regclass('zoen_maintenance.payload_backup_inventory') IS NOT NULL AS present \gset
\if :present
INSERT INTO zoen_maintenance.payload_backup_inventory(repository,oldest_backup_start,observed_at)
VALUES ('zoen',to_timestamp(:'oldest'::double precision),clock_timestamp())
ON CONFLICT(repository) DO UPDATE SET oldest_backup_start=EXCLUDED.oldest_backup_start,
  observed_at=EXCLUDED.observed_at;
\endif
SQL
