#!/bin/sh
# Disposable container proof: only synthetic data in the supplied /data volume.
set -eu
umask 077
mkdir -p /data/memory
printf 'embedding_provider = "none"\n[dream]\nenabled = false\n' > /data/config.toml
export AI_MEMORY_AUTH_TOKEN=synthetic-file-memory-container-proof
memory_pid=
stop() {
  if [ -n "$memory_pid" ]; then
    kill -TERM "$memory_pid"
    wait "$memory_pid"
    memory_pid=
  fi
}
trap stop EXIT INT TERM
start() {
  ai-memory --data-dir /data/memory --config /data/config.toml serve --transport http --bind 127.0.0.1:8080 > /data/engine.log 2>&1 &
  memory_pid=$!
  ready=false
  for attempt in $(seq 1 100); do
    kill -0 "$memory_pid"
    if curl -fsS -H "Authorization: Bearer $AI_MEMORY_AUTH_TOKEN" http://127.0.0.1:8080/admin/status > /dev/null 2>&1; then ready=true; break; fi
    sleep 0.1
  done
  [ "$ready" = true ] || { cat /data/engine.log; exit 1; }
}
start
curl -fsS -H "Authorization: Bearer $AI_MEMORY_AUTH_TOKEN" -H 'Content-Type: application/json' \
  -d '{"workspace":"zoen","project":"learned","path":"notes/proof.md","body":"# Linux proof\nCedarbay survives restart."}' \
  http://127.0.0.1:8080/admin/write-page > /data/write.json
stop
start
curl -fsS -H "Authorization: Bearer $AI_MEMORY_AUTH_TOKEN" \
  'http://127.0.0.1:8080/admin/read-page?workspace=zoen&project=learned&path=notes%2Fproof.md' > /data/read.json
grep -q 'Cedarbay survives restart' /data/read.json
git -C /data/memory/wiki log -1 --format=%H > /data/checkpoint.txt
[ -s /data/checkpoint.txt ]
printf 'File memory survived Linux engine restart with Markdown and Git intact.\n'
