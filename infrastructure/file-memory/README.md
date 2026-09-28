# File memory runtime

The application uses the official MIT-licensed Akita ai-memory 2.4.1 executable.
The root Dockerfile verifies the release archive checksum for Linux amd64 and
arm64 and includes the upstream license. Markdown and Git are authoritative;
SQLite search indexes are derived. Each authorized personal namespace has separate
source-session and learned-note engines. This is not a shared global memory server.

Set `ZOEN_AI_MEMORY_BINARY` to the executable and `ZOEN_SESSION_ARCHIVE_DIR` to
durable private storage. The hosted definition expects `/var/lib/zoen/memory` on a
retained volume. Its entrypoint rejects a missing mount instead of silently writing
to the machine's ephemeral disk. Engine processes use private permissions and
loopback authentication. Dreams and embeddings remain disabled pending their own
provider, isolation and evaluation qualification.

## Disposable Linux proof

Run from the repository root. The proof uses synthetic notes on a temporary in-memory
filesystem, verifies an exact read after process restart and checks the Git commit.
It does not demonstrate a full application restore or infrastructure capacity.

```sh
docker build --target memory-engine --platform linux/arm64 -t zoen-memory-proof:2.4.1 .
docker run --rm --network none --tmpfs /data:mode=0700 \
  --mount type=bind,source="$PWD/infrastructure/file-memory/verify.sh",target=/verify.sh,readonly \
  zoen-memory-proof:2.4.1 sh /verify.sh
```

Repeat with `linux/amd64` and an amd64 image tag when qualifying that architecture.

## Hosted cutover is not deployed

The previous hosted Mem0 machine and database are retained records, not resources
to delete during this code change. New code has no Mem0 fallback, dual writes or
automatic migration of previous memories. The production definition requires an
explicit `ZOEN_FILE_MEMORY_VOLUME_ID` identifying a prepared volume. Merely setting
that value is not evidence that the old records have been transferred.

Before any hosted cutover:

- Prepare a volume in the web machine's region and inventory the existing owners
  and memory records without exposing their contents in logs.
- Agree on and verify the transfer of existing records, including owner attribution,
  pending mutations and erasure obligations. Do not reset the hosted database or
  reinterpret historical Mem0 erasure receipts as completed file-memory erasures.
- Apply the append-only database migration chain. Migration 0068 records the owner
  on new namespace-erasure receipts; it does not invent owners for historical ones.
- Restore a volume snapshot into an isolated environment and verify Markdown, Git,
  indexes, operation receipts, account authorization, deletion and restart behavior.
- Prove volume placement, backup retention, recovery objectives and write fencing
  before scaling beyond one volume owner. A mounted 10 GB disk is not evidence of
  million-account capacity or safe multi-machine writes.
- Exercise ordinary product flows in a clearly named synthetic workspace before
  switching real traffic. Keep historical resources until their data and deletion
  obligations have been explicitly resolved.

Removing an individual note ends current and indexed historical recall but retains
its local Git history. Removing an entire namespace deletes that namespace's local
raw sessions, indexes, Git history and mutation receipts. Independent snapshots and
backups retain their own lifecycle; the application does not claim to erase those
copies when acknowledging local erasure.

See [the product memory contract](../../docs/muse/file-memory.md) for current bounds,
durability guarantees, temporal semantics and remaining qualification work.
