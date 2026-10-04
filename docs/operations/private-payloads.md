# Private payload operations

Workspace Git bundles, source files, private-memory Git bundles and private
artifacts use mandatory object references containing their owner, generation,
candidate ID, SHA-256 and byte count. PostgreSQL owns authorization, publication
and erasure obligations. The private S3 service owns the bytes. There is no
bytea fallback, dual read or dual write after migration 109.

## Production configuration and activation

Configure `ZOEN_PAYLOAD_ENDPOINT`, `ZOEN_PAYLOAD_BUCKET`,
`ZOEN_PAYLOAD_ACCESS_KEY`, `ZOEN_PAYLOAD_SECRET_KEY` and `ZOEN_PAYLOAD_PREFIX`
in the Fly vaults of both the application and PostgreSQL apps before deployment.
The isolated migrator inherits only its own app vault. The deploy checks required
payload and erasure-journal secret digests in both apps before taking its backup
or stopping web; missing or ambiguous entries leave web serving. A fresh payload
digest read and both managed journal versions enter the migration action's input.
Changed vault digests between preparation and migration require a new deployment
before web can stop. Metadata proves configuration presence and version only;
actual bucket settings and consumer access still require provider qualification.
Create the Fly apps and install their payload secrets before the first hosted plan.
R2 credential
values stay in Fly vaults and are not copied into the GitHub release configuration.
The runtime token needs object read, write,
list and delete only in the dedicated private bucket. Keep public domains,
managed public access and unreviewed lifecycle deletion disabled.

The erasure journal has a separate retained bucket and existing
`ZOEN_ERASURE_JOURNAL_*` credentials bound to both apps by the same provisioner.
The existing web binding and retained bucket keep their identities. Do not collect,
expire or rewind its
immutable `erasures/` and `memory-erasures/` records when restoring PostgreSQL.
The default journal endpoint is Tigris; selecting R2 for payloads does not change
the journal's provider.

Activation requires the protected release checks, real provider qualification,
native publication and collection tests, and an observed recovery rehearsal.
The deployment takes and verifies a backup, stops every old application replica,
preflights the private provider and external erasure records, transfers the four
legacy owners, and installs the mandatory references before dropping bytea.
Provider or migration failure keeps the application stopped. Follow the existing
protected deployment recovery procedure; never start an old image against the
new schema or reset the production database to bypass a failed migration.

An ordinary upload first commits a pending coordinate with a two-minute writer
window. The SDK writes outside the publication transaction. Final authorization,
generation, revision and adoption checks run in a fresh transaction. Uncertain
SDK or SQL results remain retryable obligations rather than published success.
Readers hold native locks while retrieving and verifying canonical bytes.

## Retained backups and collection

The PostgreSQL backup-health probe publishes the earliest start time among actual
retained pgBackRest backups only after the backup, archive and disk checks pass.
The application can read this inventory but cannot refresh it. Collection stops
when its observation is more than five minutes old. A successful database backup
alone does not establish external-object recovery.

An unreferenced coordinate without a retirement time is first quarantined at
discovery time. Quarantine prevents later adoption and performs no object
deletion. Every actual collection or resweep requires that retirement to precede
the start of every retained backup. An expired pending coordinate restored from
an older backup follows the same rule; its original writer deadline does not
prove that a newer retained backup has no reference.

Orphan discovery has a separate native fence. A registered candidate cannot
become an orphan, and a discovered orphan cannot become a registered publication.
Object deletion succeeds only after a subsequent provider read proves absence.
An unknown acknowledgement retains the obligation. The minute schedule attempts
privacy erasure, orphan discovery and both collectors with bounded deadlines and
reports accumulated failures.

## Privacy erasure and complete database restoration

Authorized member removal and organization closure append exact owner/namespace
intents to the independent journal before the SQL cascade. Both ordinary memory
and creator-release corpus namespaces are captured. Account deletion retains its
existing independent account journal. The memory worker also appends namespace
intent before deleting bytes or acknowledging filesystem removal.

Run `scripts/reconcile-account-erasures.ts` before serving restored data. The
normal startup path runs it automatically. It replays both journal domains,
rejects mismatched namespace owners, recreates permanent payload erasure
obligations and removes restored namespaces. The staged legacy migration applies
the same external intent before uploading old bytes. Journal failure stops startup.

Privacy erasure waits for every previously committed writer's full deadline,
deletes only the admitted owner/namespace objects, and verifies absence before
acknowledging the filesystem or account ledger. It preserves other owners and
company-shared files. SQL erasure coordinates remain permanently fenced and
resweep daily. An authenticated archive from an erased generation cannot repair
or republish that generation after a complete older SQL backup is restored.

## Isolated regression commands

Run these sequentially because each command owns the same loopback fixture ports:

```sh
pnpm test:payloads:cutover
pnpm test:payloads:foundation
pnpm test:payloads:collection
pnpm test:payloads:restore
```

Each command creates its own disposable PostgreSQL and object service, verifies
its strict report, and removes its owned containers, volumes and archive root.
The restore case performs two complete native `pg_dump`/`pg_restore` rewinds,
executes the actual startup reconciler, waits for the real committed writer
window, and attempts recovery with an authenticated archive. Local S3 results
cannot establish Cloudflare behavior or production readiness.
