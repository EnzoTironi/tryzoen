#!/bin/sh
set -eu
umask 077
case "${1:-}" in full|diff|incr) ;; *) echo 'Expected full, diff or incr.' >&2; exit 2 ;; esac
if [ "${ZOEN_RECOVERY_ISOLATED:-}" = true ]; then
  echo 'An isolated recovery must never back up into production.' >&2
  exit 1
fi
if [ "$(id -u)" = 0 ]; then exec gosu postgres "$0" "$@"; fi
# Startup, cron and deployment share the whole sequence, including stanza setup.
# Keep the descriptor open; the kernel releases this lock on every exit path.
exec 9>/data/backup-status/backup.lock
remaining=240
until flock -n 9; do
  if [ "$remaining" -eq 0 ]; then
    echo 'Timed out waiting for another PostgreSQL backup.' >&2
    exit 1
  fi
  sleep 1
  remaining=$((remaining - 1))
done
pgbackrest --stanza=zoen stanza-create
pgbackrest --stanza=zoen check
pgbackrest --stanza=zoen --type="$1" backup
date +%s > /data/backup-status/success.new
mv /data/backup-status/success.new /data/backup-status/success
echo 'PostgreSQL backup completed.'
