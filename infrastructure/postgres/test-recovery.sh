#!/bin/bash
# Disposable, offline integration test for the actual production image.
set -euo pipefail
image=${1:-zoen-postgres-proof:pg17-backup}
prefix="zoen-recovery-ci-$$"
source_name="$prefix-source"
restore_name="$prefix-restore"
cleanup() {
  docker rm -f "$source_name" "$restore_name" >/dev/null 2>&1 || true
  docker volume rm "$prefix-source" "$prefix-repo" "$prefix-restore" >/dev/null
}
trap cleanup EXIT
common=(-e POSTGRES_PASSWORD=test-password -e POSTGRES_DB=open_instinct_prod
  -e ZOEN_MEMORY_DATABASE_PASSWORD=test-memory-password
  -e ZOEN_MATRIX_DATABASE_PASSWORD=test-matrix-password
  -e ZOEN_VAULTWARDEN_DATABASE_PASSWORD=test-vault-password
  -e ZOEN_WHATSAPP_DATABASE_PASSWORD=test-whatsapp-password
  -e ZOEN_APPLICATION_DATABASE_PASSWORD=test-app-password
  -e ZOEN_MIGRATION_DATABASE_PASSWORD=test-migrator-password
  -e PGBACKREST_REPO1_TYPE=posix -e PGBACKREST_REPO1_PATH=/backup
  -e PGBACKREST_REPO1_CIPHER_PASS=test-only-encryption-key)
docker volume create "$prefix-source" >/dev/null
docker volume create "$prefix-repo" >/dev/null
docker volume create "$prefix-restore" >/dev/null
docker run --rm -v "$prefix-repo:/backup" --entrypoint chown "$image" postgres:postgres /backup
docker run -d --name "$source_name" "${common[@]}" \
  -e ZOEN_BACKUPS_ENABLED=1 -e PGBACKREST_REPO1_S3_BUCKET=unused \
  -e PGBACKREST_REPO1_S3_KEY=unused -e PGBACKREST_REPO1_S3_KEY_SECRET=unused \
  -v "$prefix-source:/data" -v "$prefix-repo:/backup" "$image" >/dev/null
ready=false
for _ in {1..120}; do
  if docker exec "$source_name" test -s /data/backup-status/success; then ready=true; break; fi
  sleep 1
done
if [[ $ready != true ]]; then docker logs "$source_name"; exit 1; fi
docker exec "$source_name" /usr/local/bin/bootstrap-application.sh
docker exec "$source_name" /usr/local/bin/bootstrap-memory.sh
docker exec "$source_name" /usr/local/bin/bootstrap-memory.sh
docker exec "$source_name" /usr/local/bin/bootstrap-matrix.sh
docker exec "$source_name" /usr/local/bin/bootstrap-matrix.sh
docker exec "$source_name" /usr/local/bin/bootstrap-vaultwarden.sh
docker exec "$source_name" /usr/local/bin/bootstrap-vaultwarden.sh
docker exec "$source_name" /usr/local/bin/bootstrap-whatsapp.sh
docker exec "$source_name" /usr/local/bin/bootstrap-whatsapp.sh
allowed=$(docker exec "$source_name" psql -X -U postgres -d postgres -At -v ON_ERROR_STOP=1 \
  -c "SELECT has_database_privilege('zoen_memory', 'open_instinct_prod', 'CONNECT');")
[[ $allowed == f ]] || { echo 'Memory role can enter the application database.' >&2; exit 1; }
docker exec -e PGPASSWORD=test-memory-password "$source_name" psql -X -h 127.0.0.1 -U zoen_memory -d zoen_memory -v ON_ERROR_STOP=1 \
  -c "CREATE TABLE memory_probe (id int PRIMARY KEY, value vector(3)); INSERT INTO memory_probe VALUES (1, '[1,2,3]');"
docker exec -e PGPASSWORD=test-matrix-password "$source_name" psql -X -h 127.0.0.1 -U zoen_matrix -d zoen_matrix -v ON_ERROR_STOP=1 \
  -c "CREATE TABLE matrix_probe (id int PRIMARY KEY); INSERT INTO matrix_probe VALUES (1);"
docker exec -e PGPASSWORD=test-vault-password "$source_name" psql -X -h 127.0.0.1 -U zoen_vaultwarden -d zoen_vaultwarden -v ON_ERROR_STOP=1 \
  -c "CREATE TABLE vault_probe (id int PRIMARY KEY); INSERT INTO vault_probe VALUES (1);"
docker exec -e PGPASSWORD=test-whatsapp-password "$source_name" psql -X -h 127.0.0.1 -U zoen_whatsapp -d zoen_whatsapp -v ON_ERROR_STOP=1 \
  -c "CREATE TABLE whatsapp_probe (id int PRIMARY KEY); INSERT INTO whatsapp_probe VALUES (1);"
docker exec -i "$source_name" psql -X -U postgres -d open_instinct_prod -v ON_ERROR_STOP=1 <<'SQL'
CREATE EXTENSION vector;
CREATE TABLE workspaces(id int PRIMARY KEY);
CREATE TABLE workspace_repository(id int PRIMARY KEY);
CREATE TABLE workspace_revision(id int PRIMARY KEY);
CREATE TABLE workspace_memory_erasure(id int PRIMARY KEY);
CREATE TABLE recovery_vectors(id int PRIMARY KEY, value vector(3));
INSERT INTO workspaces VALUES (1);
INSERT INTO recovery_vectors VALUES (1, '[1,2,3]');
SQL
docker exec "$source_name" /usr/local/bin/bootstrap-application.sh
docker exec "$source_name" /usr/local/bin/bootstrap-application.sh
# Queue two real backups behind the same lock, then prove both reach the repo.
docker exec -i "$source_name" gosu postgres bash -s <<'SH'
set -euo pipefail
before=$(pgbackrest --stanza=zoen --output=json info | jq '.[0].backup | length')
exec 9>/data/backup-status/backup.lock
flock 9
/usr/local/bin/backup.sh full 9>&- >/tmp/backup-full.log 2>&1 &
full_pid=$!
/usr/local/bin/backup.sh incr 9>&- >/tmp/backup-incr.log 2>&1 &
incr_pid=$!
sleep 1
kill -0 "$full_pid" "$incr_pid"
[[ ! -s /tmp/backup-full.log && ! -s /tmp/backup-incr.log ]] || {
  cat /tmp/backup-full.log /tmp/backup-incr.log
  echo 'A backup bypassed the held sequence lock.' >&2
  exit 1
}
flock -u 9
if ! wait "$full_pid"; then cat /tmp/backup-full.log; exit 1; fi
if ! wait "$incr_pid"; then cat /tmp/backup-incr.log; exit 1; fi
after=$(pgbackrest --stanza=zoen --output=json info | jq '.[0].backup | length')
[[ $after -eq $((before + 2)) ]] || {
  echo "Expected two new backups, but repository count changed from $before to $after." >&2
  exit 1
}

# A real repository error must fail, preserve the success marker and unlock.
success_before=$(cat /data/backup-status/success)
sleep 1
if PGBACKREST_REPO1_CIPHER_PASS=incorrect-test-key /usr/local/bin/backup.sh incr >/tmp/backup-failed.log 2>&1; then
  echo 'A backup with an invalid encryption key unexpectedly passed.' >&2
  exit 1
fi
[[ $(cat /data/backup-status/success) == "$success_before" ]] || {
  echo 'A failed backup updated the success marker.' >&2
  exit 1
}
flock -n /data/backup-status/backup.lock true
echo 'Concurrent real backups serialized; repository failure propagated and released the lock.'
SH
# This row exists only in archived WAL, after the full backup completed.
docker exec "$source_name" psql -X -U postgres -d open_instinct_prod -v ON_ERROR_STOP=1 \
  -c "INSERT INTO recovery_vectors VALUES (2, '[4,5,6]'); SELECT pg_switch_wal();"
docker exec "$source_name" gosu postgres pgbackrest --stanza=zoen check
docker exec "$source_name" /usr/local/bin/backup-health.sh
docker stop "$source_name" >/dev/null
docker run -d --name "$restore_name" "${common[@]}" \
  -e ZOEN_RESTORE_PROOF=1 -e ZOEN_RESTORE_FROM_BACKUP=1 \
  -e ZOEN_RECOVERY_ISOLATED=true -e ZOEN_RECOVERY_HOLD=1 \
  -v "$prefix-restore:/data" -v "$prefix-repo:/backup:ro" "$image" >/dev/null
ready=false
for _ in {1..120}; do
  if docker exec "$restore_name" test -s /tmp/zoen-restore-proof.json; then ready=true; break; fi
  sleep 1
done
if [[ $ready != true ]]; then docker logs "$restore_name"; exit 1; fi
# The proof uses local connections; no service can connect to the restore copy.
docker exec "$restore_name" pg_isready -h 127.0.0.1 -U postgres
restore_ip=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$restore_name")
[[ -n $restore_ip ]] || { echo 'Restore container has no network address to probe.' >&2; exit 1; }
if docker exec "$restore_name" pg_isready -h "$restore_ip" -U postgres -t 2; then
  echo 'An isolated restore accepts database connections on its network interface.' >&2
  exit 1
else
  [[ $? == 2 ]] || { echo 'Could not verify the isolated network listener.' >&2; exit 1; }
fi
echo 'Isolated restore accepts loopback connections and refuses its network interface.'
actual=$(docker exec "$restore_name" psql -X -U postgres -d open_instinct_prod -At -v ON_ERROR_STOP=1 \
  -c "SELECT count(*) = 2 AND max(value <-> '[4,5,6]'::vector) > 0 FROM recovery_vectors;")
[[ $actual == t ]] || { echo 'WAL recovery lost a committed vector.' >&2; exit 1; }
actual=$(docker exec -e PGPASSWORD=test-memory-password "$restore_name" psql -X -h 127.0.0.1 -U zoen_memory -d zoen_memory -At -v ON_ERROR_STOP=1 \
  -c "SELECT count(*) = 1 FROM memory_probe WHERE value = '[1,2,3]'::vector;")
[[ $actual == t ]] || { echo 'Restored memory database or credentials failed.' >&2; exit 1; }
actual=$(docker exec -e PGPASSWORD=test-matrix-password "$restore_name" psql -X -h 127.0.0.1 -U zoen_matrix -d zoen_matrix -At -v ON_ERROR_STOP=1 \
  -c "SELECT count(*) = 1 FROM matrix_probe;")
[[ $actual == t ]] || { echo 'Restored Matrix database or credentials failed.' >&2; exit 1; }
actual=$(docker exec -e PGPASSWORD=test-vault-password "$restore_name" psql -X -h 127.0.0.1 -U zoen_vaultwarden -d zoen_vaultwarden -At -v ON_ERROR_STOP=1 \
  -c "SELECT count(*) = 1 FROM vault_probe;")
[[ $actual == t ]] || { echo 'Restored vault database or credentials failed.' >&2; exit 1; }
actual=$(docker exec -e PGPASSWORD=test-whatsapp-password "$restore_name" psql -X -h 127.0.0.1 -U zoen_whatsapp -d zoen_whatsapp -At -v ON_ERROR_STOP=1 \
  -c "SELECT count(*) = 1 FROM whatsapp_probe;")
[[ $actual == t ]] || { echo 'Restored WhatsApp database or credentials failed.' >&2; exit 1; }
actual=$(docker exec -e PGPASSWORD=test-app-password "$restore_name" psql -X -h 127.0.0.1 -U zoen_app -d open_instinct_prod -At -v ON_ERROR_STOP=1 \
  -c "SELECT count(*) = 1 AND NOT has_schema_privilege('zoen_app', 'public', 'CREATE') AND NOT pg_has_role('zoen_app', 'zoen_migrator', 'MEMBER') FROM workspaces;")
[[ $actual == t ]] || { echo 'Restored runtime role isolation failed.' >&2; exit 1; }
docker exec "$restore_name" cat /tmp/zoen-restore-proof.json
if docker exec "$restore_name" /usr/local/bin/backup.sh full; then
  echo 'An isolated restore must not write backups.' >&2
  exit 1
fi
echo 'Encrypted backup, WAL replay, memory, Matrix, WhatsApp, vault and runtime role recovery passed.'
