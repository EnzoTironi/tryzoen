# File-based memory: Akita and Muse

## Accepted direction, 2026-09-28

The user selected Muse's readable files and [Fabio Akita's ai-memory](https://github.com/akitaonrails/ai-memory), including persisted sessions, dreaming, relations and temporal recall. This supersedes the previous decision to retain Mem0 as the target learned-memory system. The local learned-memory path now uses Akita as described below. The hosted installation has not been cut over; Eve's separate profile adapter remains. Remove them with their complete replacement slices and callers, without a fallback or dual-write migration.

Eve continues to own execution, sessions and approvals. PostgreSQL owns Zoen accounts, grants, memberships and product records. Memory content becomes file-authoritative, with the upstream engine preferred over a TypeScript reimplementation of indexing, versioning, graph and consolidation. Shared web/Electron/Expo clients use authenticated product APIs and the existing visual Markdown editor.

Reviewed upstream: release **v2.4.1**, main commit `49147a5d173657031b6b846e5beb8a839219c050`. These are separate identifiers, not an assertion that main equals the release tag. MIT, copyright 2026 Fabio Akita. The acceptance executable lives outside this repository; no upstream source is vendored and no coding-agent hooks are installed. Redistribution must retain its license.

## Preserve the upstream contracts

| Concern         | Required behavior                                                                                                                                                                                                                                    |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Files           | Readable Markdown in `wiki/`, atomic writes, Git versions, one writer per data directory. Derived SQLite full-text/entity/graph indexes are not a competing content authority.                                                                       |
| Session sources | Immutable, bounded, sanitized visible transcript segments on durable disk, with session/turn/event identities, source timestamps and provenance. Exclude hidden reasoning, auth headers, credentials, payment secrets and private provider payloads. |
| Retrieval       | Bounded full-text, entity and graph fusion; optional vectors with provider/model/dimension attached. Source paths and versions accompany recall. Ordinary queries use current versions.                                                              |
| Relations       | Exactly `causes`, `fixes`, `contradicts` in Markdown frontmatter. Ordinary wikilinks remain references; no invented free-text taxonomy.                                                                                                              |
| Versions        | Corrections supersede and close ingestion windows transactionally. Preserve source history. Explicit purge is different from supersession.                                                                                                           |
| Consolidation   | Zero-LLM capture/retrieval remains usable. Session consolidation and the optional LLM dream pass are distinct operations.                                                                                                                            |
| Dreams          | Opt-in, with provider and embedder. Bounded cold clusters after inactivity; stop between clusters when activity resumes; retain source versions, evidence and observable reports. Dry-run and recall evals precede default rewriting.                |
| Authored rules  | SOUL, identity and explicit instructions remain distinct from learned notes. Dreams must not silently rewrite author-controlled rules, published permissions or connector grants. Preserve pinned/invariant policies.                                |
| Deletion        | State exactly what is removed from files, indexes, history, raw sessions and backups. A note edit does not erase earlier conversation messages.                                                                                                      |

Sources: upstream [architecture](https://github.com/akitaonrails/ai-memory/blob/49147a5d173657031b6b846e5beb8a839219c050/docs/ARCHITECTURE.md), [relation vocabulary](https://github.com/akitaonrails/ai-memory/blob/49147a5d173657031b6b846e5beb8a839219c050/crates/ai-memory-core/src/page.rs), [transcript storage](https://github.com/akitaonrails/ai-memory/blob/49147a5d173657031b6b846e5beb8a839219c050/docs/managed-workstreams.md).

## Temporal precision

Upstream calls this **bi-temporal-lite**, explicitly **ingestion time only**: when the store learned/replaced a version, not when it was true in the world. Pages use `[valid_from, valid_to)`; entity links use corresponding `valid_from`/`superseded_at` windows. Relations retire with their source version.

`as_of` fuses historical entity links and version-filtered full-text search. It excludes current graph neighbors, vectors, raw-observation fallback, access reinforcement and reranking. It cannot combine with global/multi-scope queries. Historical content is recovered, but ranking is not a historical snapshot: current FTS statistics can change ordering. TTL differs between the entity and FTS streams as documented upstream. Do not label this full world-time/transaction-time bitemporality or infer fact dates using an LLM. A future world-time extension needs a separate product decision and tests.

Source: [upstream temporal contract](https://github.com/akitaonrails/ai-memory/blob/49147a5d173657031b6b846e5beb8a839219c050/docs/temporal.md).

## Isolation and social/Matrix

Upstream is **single-tenant wiki data with multi-user attribution**, not per-user/page authorization. Every authenticated operator of an instance sees its wiki. Workspace/project names, author headers and separate API keys are not private-account boundaries. Exposing generic MCP directly to consumer clients/agents would permit global searches across those scopes.

Provision a distinct engine data boundary for each private memory owner; separately authorized community and published expert corpora get their own boundary. Resolve destinations server-side from current Zoen ownership/grants. Never accept an engine URL, filesystem path, upstream scope or global-search flag from the client/model. Qualify placement, suspend/resume, quotas, backups and concurrency before selecting production topology: one always-on process per million accounts is not a capacity plan. Durable disk means persistent storage, not a Next/Vercel temporary directory or ephemeral Eve sandbox.

Publishing an expert agent publishes only selected knowledge, never the creator's personal memory or users' private sessions. Room consolidation remains room-scoped. Moving a conclusion into personal memory is an explicit product action with attribution. See [social/Matrix handoff](tryzoen-social-matrix-handoff.md).

Source: [upstream multi-user limitations](https://github.com/akitaonrails/ai-memory/blob/49147a5d173657031b6b846e5beb8a839219c050/docs/users.md).

## Implementation order

1. **Qualify the real engine.** Run the isolated acceptance below: temporal content, relation provenance, restart and file history without provider calls. Never use a real user's data directory.
2. **Complete Eve capture.** Existing ownership lives in `agent/hooks/session-owner.ts`. Lifecycle events enqueue durable, owner-bound receipts; project visible messages and allowlisted tool summaries, sanitize before disk, deduplicate stable event identities, and recheck revocation/deletion before committing. Export bounded segments, never whole-conversation reads inside hooks.
3. **Use supported ingestion.** Upstream managed-run endpoints allow specific CLI harnesses and reject Eve. Do not impersonate Codex/Claude, call a 202 response durable completion, or write upstream SQLite from Zoen. Add a maintained Eve/generic ingestion adapter upstream, or qualify the supported hook contract plus an explicitly owned raw archive. Prove raw storage, provenance and source-to-page consolidation together before enabling capture.
4. **Replace learned-memory end to end.** Save, recall, correction, deletion, export and editing use one authorized memory owner. Update native Eve slots/all clients and remove Mem0 plus obsolete schema/config/API in the operational slice. Retain behavior/authorization tests. Production persistence policy still applies; do not reset production to simplify replacement.
5. **Enable dreams with evidence.** Provide enable/model controls, observable runs and undo. Test recall quality, idle/resume cancellation, interrupted writes and erasure during a dream. Archiving alone is not a working dream loop. Files and indexes require a recoverable backup snapshot.
6. **Measure deployment.** Bound capture/backpressure and storage per owner. Prove placement and crash recovery under concurrent load. Million-account readiness remains unproven.

The Eve registry search did not return a matching native Akita integration. The existing MCP SDK is reused for acceptance; no second agent framework is introduced.

## Repeatable acceptance

Download the official **v2.4.1** binary for the host architecture and verify its published SHA-256 before execution. Tested macOS arm64 archive SHA-256: `0c1b820d08ca647a7f5e05cb1fd35e1d745b4166e39bb9e066af7810f8eacb42`.

```sh
pnpm exec tsx scripts/ai-memory-acceptance.ts /absolute/path/to/ai-memory
```

The harness uses disposable synthetic stores and explicit configuration. It does not install hooks, touch Zoen databases, inherit provider secrets or enable dreams. Test directories and a JSON report remain available for inspection. This proves engine behavior, not deployed integration, Zoen authorization, dream quality or capacity. The separate lifecycle qualification below distinguishes restoring a complete snapshot from rebuilding an index with Markdown alone. The report lists pending gates explicitly.

## Native dream qualification — 2026-09-28

`pnpm test:memory:dream /absolute/path/to/ai-memory` exercises the pinned 2.4.1
executable against disposable synthetic corpora and a loopback-only model and
embedding fixture. No application database, user files or provider credentials
are inherited. Requests, bounded native logs and a JSON report are retained in
the printed private temporary directory. CI runs this after ingestion and restore
qualification. A completed report distinguishes passed contracts, reproduced
upstream blockers and unimplemented product gates; it is not a product-readiness
verdict. A failing harness writes `status: failed` and exits unsuccessfully.

The native scheduler consolidates a deliberately cold cluster of two episodic
pages while leaving an unrelated third page unchanged. Tests cover the disabled
flag, malformed output (including native unstructured fallback), death while
awaiting the model, reopening without forced unlocking, source Git history,
merged-page provenance, an explicit Git checkpoint, pre-dream `as_of` after
restart, public `restore-page`, a separate person's empty corpus and resuming
MCP activity between two eligible clusters. This is 11 qualified contracts.
Fixtures accelerate time and supply deterministic vectors and text; they do not
measure real-model accuracy, cost, production idle behavior or capacity. The
process-death case precedes apply; interruption halfway through apply remains
unqualified.

Two live public-MCP races reproduce on the release: while the model response is
held, editing both source pages is acknowledged, but the old pending merge then
overwrites both corrections; deleting both pages is acknowledged, but the merge
recreates them. The edit remains accessible through pre-merge temporal history,
which does not make replacing current user intent acceptable. The harness lists
these as `v2.4.1-in-flight-dream-overwrites-later-user-edit` and
`v2.4.1-in-flight-dream-recreates-deleted-pages`. No real person's corpus was used.

The released [dream implementation](https://github.com/akitaonrails/ai-memory/blob/v2.4.1/crates/ai-memory-consolidate/src/dream.rs)
reads source bodies before calling the model and applies the resulting batch
later. Cancellation is checked between clusters, not before committing the
in-flight cluster. The [scheduler](https://github.com/akitaonrails/ai-memory/blob/v2.4.1/crates/ai-memory-cli/src/commands/serve.rs)
samples activity every two seconds and discards detailed merge reports after
logging aggregate counts. There is no public `dream` command or `/admin/dream`
endpoint in the release; the Rust dry-run function is not an exposed service
contract. Native scheduled changes also need an explicit Git checkpoint for a
durable review revision.

**Product dreams remain disabled.** Do not enable this scheduler on an active
Zoen corpus or treat its log lines as a durable workflow receipt. The next
implementation must either qualify an upstream revision-checked apply/report
contract or run native consolidation against an isolated snapshot, persist
reviewable candidate changes and apply them through Zoen's current authorization,
namespace serialization and exact source-revision checks. An edit, deletion,
membership loss or changed source revision must invalidate the candidate.
Snapshot creation/promotion must follow the quarantined-restore constraints below.
Provider choice, explicit owner opt-in, observable runs, bounded retries/cost,
recovery and erasure of staged copies remain implementation requirements. A room,
another participant and a creator's published teaching must never become implicit
sources for a personal dream; see the social/Matrix handoff.

Local macOS arm64 verification passes all 11 dream contracts above, the existing
17 ingestion and seven restore contracts, and 25 isolated PostgreSQL cases for
learned notes, authorization and total-corpus loss. The shared memory protocol
retains the 64 KiB note-result bound, single text block and cancellation signal;
the source-observation qualification requests its separate, explicit 4 MiB bound.
Four boundary tests cover per-call bounds, invalid limits, private error details
and ambiguous results. `pnpm check` passes all nine tasks (1,327 tests in 206
files) and `pnpm build` passes. The structural delta has three unsuppressed gating
findings for a process-stop idiom and recent edits; new fixture size/complexity
also remain visible. This is not a clean structural, production or capacity gate.

## Eve source capture — 2026-09-28

Implemented behind `ZOEN_SESSION_ARCHIVE_DIR`, an absolute directory on a persistent, private POSIX filesystem. It is configured only for local review; a Vercel temporary directory is not a deployment target. Hooks capture visible `message.received`, `message.completed` and turn completion/cancellation/failure coordinates. Framework background inputs, reasoning, tools and provider payloads are excluded. Known credential patterns are redacted before the delivery queue, without claiming perfect recognition of arbitrary secrets.

PostgreSQL holds a bounded outbox (1,000 pending events and 8 MiB of encoded JSONB per private namespace), stable event hashes and a monotonic capture sequence. Ownership is checked against the persisted Eve session. The minute schedule delivers at most 25 events, rechecks live membership under a lock and publishes immutable `0600` JSONL files in `0700` directories under `<root>/<namespace UUID>/raw/eve/<session hash>/<event hash>.jsonl`. Each line retains the original session/event IDs, segment index/count and timestamps; the capture sequence orders delivery independently of wall-clock/event-ID sorting. Content leaves the outbox only after filesystem sync. Retries compare exact existing bytes, including after a database acknowledgement rolls back. Namespace erasure removes its Eve raw subtree through the existing durable erasure receipt.

This is a source record, not authoritative accepted assistant history: retried Eve attempts remain distinguishable and assistant blocks carry `settlement: unverified`. Version 2 source files preserve complete redacted messages up to 1 MiB, split into ordered JSONL segments of at most 2,048 UTF-16 code units without splitting surrogate pairs. Oversize messages fail explicitly instead of being truncated; redaction occurs before segmentation. Attachment sources, retention, complete account export, recall suppression after selective forgetting, accepted intermediate-message attribution and production delivery throughput are still required. Delivered sources can be exported per conversation as described below. The qualified local worker described below can now ingest new user sources into Akita. No dreams run. Pausing memory blocks capture and queued delivery until resumed; it does not erase previously captured conversations.

Initial capture evidence (before the ingestion extension below): three filesystem tests and five isolated PostgreSQL/filesystem integration tests cover private permissions, traversal/symlink rejection, repeated delivery, durable acknowledgement rollback, bounded batches, revoked membership and account erasure fencing. A synthetic browser conversation on the current Eve runtime produced user/assistant/turn files through the real schedule dispatch and retired all three outbox payloads. Eve development schedules require explicit dispatch; the production cron is not exercised by that local dispatch. A previous development session whose compiled snapshot was already absent could not resume; this is not evidence of production restart recovery.

## Qualified local Akita ingestion — 2026-09-28

`ZOEN_AI_MEMORY_BINARY` enables the official **2.4.1** executable in the session delivery worker when `ZOEN_SESSION_ARCHIVE_DIR` is configured. This is a local/persistent POSIX worker, not a deployed replacement for learned-memory recall. The binary must be independently checksum-verified. `uuid` 14.0.2, the current stable registry release at implementation time, supplies RFC UUIDv5 identities; the existing MCP SDK supplies the client transport.

The worker opens `<root>/<namespace UUID>/ai-memory` with its own `wiki`, Git history and derived index. A namespace lock serializes workers and fences membership revocation/account deletion while the engine is alive. One engine is open at a time in each bounded worker batch. It binds an OS-selected loopback port with a random per-process bearer token, inherits no application/provider credentials, and pins a private configuration with embeddings and dreams disabled. Upstream's own data-directory lock remains in force. The generic MCP connection and its authority stay behind the server boundary. Rooms and published bots are not mapped into these personal stores.

The supported **`POST /hook/batch`** endpoint processes events inline. Zoen validates individual acknowledgements and then reads bounded, scope-specific observation pages to verify each segment's source marker and Eve provenance. A successful HTTP response alone is insufficient: upstream can acknowledge deliberate policy drops. Stable ingestion keys and persisted segment markers allow retries after a lost response or process restart to skip already stored source segments. Turn-end delivery is replayed to finish downstream summary effects. Files remain immutable, and outbox content is cleared only after disk synchronization plus verified ingestion when enabled.

Each Eve turn maps to its own upstream session using its private namespace, session ID and turn ID. User text uses the supported `other` agent plus `eve` extension; there is no Claude/Codex impersonation. Turn completion, failure or cancellation closes that source session and produces upstream's zero-LLM episodic summary. This summary is not a distilled fact database or a dream. Assistant stream attempts remain in raw files with `settlement: unverified`. The additional native Eve memory capture below archives the accepted final reply. **Both remain excluded from upstream ingestion**: Akita 2.4.1 permits its assistant-capture protocol only for Claude Code and Codex Stop events, not generic/Eve clients. Do not mislabel an Eve assistant reply as a user prompt or impersonate a supported CLI. Thus this is not full conversation-memory parity yet.

Account/namespace erasure removes both `raw/eve` and its derived `ai-memory` directory, including that directory's local Git/index files. The existing external erasure receipt still tracks other memory providers. This does not assert deletion of external backups or snapshots. Sources already delivered before enabling the engine are not automatically imported.

Fresh verification: five source/filesystem tests and one memory-scope test; nine isolated PostgreSQL tests also run against the real executable; 17 upstream acceptance contracts including partial-delivery acknowledgement loss, restart deduplication, source-to-Git-versioned-Markdown, private-directory isolation and erasure. The acceptance harness uses synthetic data only and retains a JSON report. A separate IPC-bound supervisor terminates the engine when its application owner disconnects, including SIGKILL, with one second of graceful shutdown before forced termination and a 15-minute absolute lifetime. The crash test kills the actual owner process, proves a competing writer is refused before the crash, and then reopens the same store and recalls the committed note without force-unlocking. It does not prove recovery after the supervisor itself is killed, host/volume failure, dreaming or production placement.

Browser verification used an ordinary synthetic conversation after rebuilding/restarting the local runtime. Its Rosehaven turn produced three upstream observations (session start, user input and turn end), a readable Markdown summary, and three retired outbox payloads. The archived start/end times remained `2026-09-28T04:56:22.616Z` and `2026-09-28T04:56:26.205Z`; assistant text stayed raw-only. This caught and corrected a start-time bug that used delivery time. The previous running backend did not hot-reload that module, so the final check used a fresh process. `pnpm check` passed 1,318 tests across 203 files, and `pnpm build` passed.

Remaining deployment work: qualify host/container supervision and volume recovery, choose persistent-volume placement and tenant quotas, measure throughput/fairness under backlog and failures, keep paused namespaces from learning, qualify backup/restore/retention and selective forgetting, then replace Mem0's complete product surface. The current 25-event minute batch is a bounded delivery implementation, not a million-account capacity result. The structural review retained a 19-point receipt-validation function for its explicit fail-closed checks; the redaction helper export also triggers the tool's historical-churn heuristic. These are recorded tradeoffs, not a claim of a clean structural gate.

## Accepted final replies — 2026-09-28

The native `agent/memory/session-sources.ts` slot uses the public `capture["turn.completed"]` contract, whose message projection contains settled history. Eve 0.63.0 omitted that history when emitting completion, silently skipping the callback; a narrow [documented dependency patch](../../patches/README.md) forwards its accepted history on settled model completions. The published 0.67.2 epilogue still has the omission. Approval/input pauses are unchanged. A compiled Eve regression verifies capture, exclusion of a cancelled response and continuation after process restart without duplicate receipts; the four existing cancellation/rebinding regressions also pass.

The slot extracts only visible text from the final assistant message, excludes reasoning/tool/provider parts, redacts before segmentation and reuses the same owned outbox and immutable files. The resulting `message.settled` record has `settlement: accepted` and a stable event identity derived from Eve's operation ID. The public callback supplies no message timestamp, so `occurredAt` is explicitly null; the durable capture sequence supplies ordering. Retries produce the same receipt instead of inventing a new capture time.

Only private authenticated sessions activate this slot. Shared rooms, group bindings, agent grants, protocol agents, service principals and unknown authenticators cannot contribute to a personal archive. Capture rechecks current identity against the locked session scope, then current membership and persisted Eve session ownership. Pausing memory applies to these records as well. This step identifies the final accepted reply; earlier streamed/intermediate blocks remain unverified. Eve logs a capture callback failure after a successful turn, so historical reconciliation after capture failure remains release work.

A fresh browser turn in the synthetic review account returned `Cedarbay confirmado`. The real schedule delivered four private source files: user input, the unverified stream message, the accepted final reply and the turn boundary. All four outbox payloads were retired after delivery; the accepted file matched the rendered answer exactly and retained its explicitly absent timestamp. `pnpm check` passed 1,320 tests across 204 files, `pnpm build` passed, and the five compiled runtime capture/cancellation/rebinding cases passed against the isolated database. The structural delta flags only short-horizon churn in `captureSessionSource`: its input now accepts both supported source projections, with every caller and authorization test updated. No structural regression was suppressed.

Source: the installed Eve 0.63.0 public memory-provider documentation and types; upstream's [assistant capture contract](https://github.com/akitaonrails/ai-memory/blob/49147a5d173657031b6b846e5beb8a839219c050/crates/ai-memory-hooks/src/assistant_capture.rs). Extending generic assistant ingestion requires a qualified upstream change, not disabling its capture policy.

## Conversation source export — 2026-09-28

The shared conversation menu now offers an archive download on web/Electron and the Expo native sharing adapter. It is a mobile sheet and a centered desktop modal. The existing paginated conversation library is the entry point; there is no second account-wide file browser. The menu explains that only already-saved messages are included and attachments remain separate. Missing archives retain the menu and a retryable message.

`GET /api/conversations/[id]/archive` authenticates the current account/workspace. The server streams exact delivered JSONL source blocks, retaining segmentation and accepted/unverified provenance. Blocks carry their capture sequence; filesystem enumeration is not chronological sorting or a point-in-time snapshot. This is a conversation source export, not a complete account backup. Pending outbox entries and sources never captured before archive enablement are not reconstructed.

Each file is read under a fresh live membership/session/namespace check and matched against its durable digest and delivery receipt. The reader rejects symlinks, public file permissions, inconsistent segments and unowned sources. Memory pause permits the owner to download previously saved sources. Cancellation and revocation stop subsequent reads. Reads allocate at most 8 MiB per source file; requests have a 60-second deadline, a 10,000-directory-entry limit and a 128 MiB content limit. Exceeding a limit or encountering an invalid file fails the stream rather than claiming a complete download. Web creates a download only after receiving the complete response; native sharing uses Expo's file download and removes its temporary directory afterward. These limits do not prove aggregate capacity or backup recovery.

Twelve isolated archive/database tests include owner and workspace isolation, segmented export, paused-memory export, revocation during streaming, cancellation and content tampering. Three native adapter tests cover authenticated download, cleanup after failure and unavailable sharing; they are not real-device proof. A synthetic Chrome download produced a 1,516-byte JSONL file with exactly four records from the Cedarbay session, including its accepted final reply. The missing-archive error and mobile/desktop menu layouts were inspected separately. `pnpm check` passed 1,323 tests across 205 files; `pnpm build` and Expo web/iOS/Android exports passed. The Expo results qualify bundles, not signed applications or device behavior. The structural review separated menu presentation and receipt verification from their callers; remaining findings include recent edits and small JSX/stream-lifecycle length overruns, with no suppression of findings.

## Learned notes replacement — 2026-09-28

The application learned-memory owner now calls Akita directly. The Mem0 HTTP
adapter, application variables and service source have been removed. Native Eve
save/recall/remove tools, workspace review/correction, shared web/Electron/Expo
controls and merged-account export use the same owner. Profile notes remain a
separate Eve surface. The learned-note editor uses the shared visual Markdown
editor, including the existing `/space/memory` route.

Each private namespace has a `learned-memory` engine directory alongside its
`ai-memory` session corpus. Learned notes use `notes/<stable UUID>.md`. No raw
conversation fallback is available in learned-note search. Zoen passes a fixed
workspace/project, quotes at most 32 plain query terms and requests eight hits;
ordinary reads require an authoritative Markdown file, rejecting derived-index
fallback. Disk enumeration is bounded to 200 notes instead of silently truncating
at upstream `memory_recent`'s 100-page ceiling. Notes contain at most 8,000
characters. Upstream still owns indexing, Git versions and supersession.

Content-free mutation receipts are fsynced before any side effect and atomically
completed after the write/delete and Git checkpoint are verified. Their stable
operation IDs survive restart and later deletion: replaying an old save cannot
recreate a removed note, and replaying an old clear cannot erase newer notes.
Interrupted receipts fail closed; existing Zoen recovery requires reviewing
current notes and never blindly repeats the old write. There is a 10,000-receipt
per-corpus bound. This is a bounded initial product limit, not a sharding or
million-account capacity result.

A correction supersedes the former version. Ordinary note removal deletes the
live file and its indexed versions, including their `as_of` results, but retains
Git history and external snapshots. UI copy states that distinction. Full
namespace erasure removes both engine directories and raw source files. Migration
0068 carries the erased namespace's owner into its durable receipt so the final
successful removal can acknowledge the account's `file_memory` ledger entry.
Historical `mem0` obligations remain pending; the new worker cannot certify an
old external provider was purged. No production records were migrated or erased.

The root Dockerfile downloads official 2.4.1 Linux assets with pinned SHA-256 and
retains the MIT license. Native arm64 and emulated amd64 container checks verify
Markdown/Git after engine restart, without network access or model credentials.
The paired Next/Eve host requires a retained `/var/lib/zoen` volume; production
configuration requires `ZOEN_FILE_MEMORY_VOLUME_ID` pointing to an already
prepared, verified volume. Startup rejects an absent mount. This gate is not an
import or backup-restore proof. Production cutover, historical reconstruction
from backup, selective Git purging, complete historical document/temporal editing, full
assistant ingestion and dreaming remain outstanding. Private relation controls
are described below.

### Verified learned-note checkpoint — 2026-09-28

`pnpm check` passed 1,323 tests in 205 files and the application, desktop and
mobile type checks; `pnpm build`, Expo web/iOS/Android exports and `pnpm db:check`
passed. Thirty isolated runtime tests cover the real file engine, account
deletion, owner separation, replay, correction, erasure and session capture.
The upstream acceptance script passed its 17 contracts after the engine change;
infrastructure types and 28 provider tests also passed.

In Chrome on the local synthetic review account, a formatted Cedarbay note was
saved, reopened and corrected. Both writes produced Git checkpoints. Pause and
resume preserved the note. A new conversation
`wrun_01M3KBZARM9VYECMDWJADWCJ9M` recalled Saturday at 10:00 and the newly added
north entrance without those details appearing in its prompt. Desktop and
390-pixel responsive editor screenshots record this flow. These are web evidence,
not native-device or hosted-installation proofs.

The shared companion exposes review, correction, pause, recovery and deletion
controls. Both this entry point and `/space/memory` use the shared visual document
editor; the latter's old plain-text Markdown editing form is removed. The
structural quality report remains non-green: churn and wrapper-similarity findings
were reviewed, while the new bounded filesystem discovery, mutation handling and
note screen remain candidates for simplification. It is not a clean global
quality or scale verdict.

## Historical learned-note search — 2026-09-28

The shared memory screen opens a desktop modal or mobile sheet for a topic and
local date/time. Its validated instant calls Akita's `memory_query` with `as_of`,
fixed private workspace/project scope and at most eight results. The native Eve
`learned__search_memory_history` tool exposes the same operation only for an
explicit historical question. These are ingestion-time versions: when Zoen
recorded a fact, not when the fact became true in the world.

Results retain the upstream version UUID and matching historical excerpt. They
never read the current Markdown body to fill in a historical result. Akita 2.4.1
does not expose a version selector on `memory_read_page`; its `as_of` hits also do
not reliably carry a `superseded` flag, so neither complete historical documents
nor that flag are invented. Upstream highlighting is removed and excerpts render
as text. Current notes stay unchanged. Removed files, unexpected retrieval
streams, raw/global search and foreign paths are excluded or rejected.

Live membership, personal-memory policy, namespace ownership, pause and pending
mutation fences apply before opening the engine. Eleven isolated PostgreSQL and
real-engine cases cover correction followed by historical recall, current-result
exclusion, deletion, foreign users, forged actors, invalid instants, unexpected
fields, pause and unsettled writes. Historical ranking and restoration after
index loss remain upstream limitations described above.

Chrome verified the old Cedarbay excerpt without the later north-entrance
correction in both responsive layouts. A fresh ordinary conversation invoked the
native historical tool successfully. A pre-update local development conversation
continued using its older tool catalog; Eve development runs select a compiled
generation. A separate compiled-server regression creates a session, replaces a
memory tool, recompiles without clearing its database, restarts and verifies that
the same session receives the new tool and loses the old one. This passed; it is
not a hosted rolling-deployment qualification.

Final checkpoint checks passed: `pnpm check` (1,323 tests / 205 files),
`pnpm build` and Expo web/iOS/Android exports. The structural delta has nine
gating findings, including short delegation wrappers and test-fixture churn;
the moved note screen is also reported as a new large component. These were
reviewed without suppression and are not a clean structural-quality verdict.

## Private typed relationships — 2026-09-28

Learned notes expose Akita’s closed `causes`, `fixes`, `contradicts` vocabulary in
both the shared companion and `/space/memory`. The same relation editor opens as
a desktop modal or mobile sheet; Markdown text edits still use the shared visual
editor. Selection is limited to existing notes in this person’s private workspace
corpus, with 20 outgoing links per note and bounded search over at most 200 notes.
Deleted targets remain labeled as removed until the user removes their link. No
private corpus is joined to a colleague’s memory, creator playbook or community.

`learned__relate_memory` uses the same owner-bound service and exact recalled IDs.
It requires an explicit user-stated/approved relation and the current outgoing
relations as an optimistic precondition; similarity is not evidence of causality.
The actor’s membership, human session, namespace lock, recall fence and durable
content-free operation receipt remain the authority. An old successful operation
cannot restore links that a subsequent operation removed. Conflicting/unfinished
writes require review and recovery, and foreign IDs never become paths or scopes.

Akita 2.4.1’s MCP and admin write-page endpoints do not accept relation metadata.
Zoen therefore uses its documented human-editable Markdown/watcher path: it
preserves the body and other frontmatter values, emits canonical YAML with the
maintained `yaml` 2.9.1 package, writes a private temporary file, fsyncs and atomically
renames it, waits for a changed upstream page-version ID, verifies the source and
calls the native `/admin/commit`. Source formatting/comments may be normalized;
there is no parallel PostgreSQL relation store or direct SQLite mutation. Existing
body corrections use this path too, so they cannot discard relationship metadata.
A failed checkpoint leaves automatic recall fenced. Explicit recovery verifies
current files and requires a successful checkpoint before resuming; uncertain
operation receipts remain tombstoned.

The bounded watcher acknowledgement uses `memory_recent` within the fixed private
scope; this upstream call also reinforces the inspected pages’ access counters.
It waits up to 12 seconds before failing closed. A dropped filesystem event whose
30-second upstream reconciliation has not run in time requires review/recovery.
This does not prove recovery of a missing index or concurrent out-of-band file
edits. Git/version history remains available to the operator; this is not a
complete historical document editor. Historical `as_of` retrieval continues to
exclude present-day graph expansion and describes ingestion time only.

The isolated real-engine tests exercise graph retrieval, source/Git agreement,
body corrections preserving relations, historical excerpts, target deletion,
replayed operations, stale replacement, person/workspace separation and a failed
Git checkpoint followed by recovery. Production deployment, dreams, embeddings,
public/community memory, backup restore and capacity qualification remain open.

Validation for typed relations: all nine workspace checks passed, including 1,323
tests in 205 files; the production build and Expo web/iOS/Android exports also
passed. Eighteen isolated runtime cases cover learned memory, source notes and
revocation/save/remove races. Chrome verified persistence after reload, the same
editor on both memory surfaces, desktop modal/mobile sheet presentation, and a
failed save retaining its draft. The interception was removed after verification.
Actual screenshots are attached with `gh --attach` to
[PR 148](https://github.com/EnzoTironi/tryzoen/pull/148#issuecomment-5866883758).

The structural report still has twelve gating findings, primarily short RPC
wrapper similarity, component length and recent ownership changes. No findings
were suppressed. The unused-code check passes; the scanner does not recognize
the shared editor's JSX usage. This checkpoint does not qualify physical devices,
production deployment, dreams, public marketplace releases or million-user load.

## Native index loss and lifecycle qualification, 2026-09-28

The engine adapter now checks an existing corpus before launching the native
writer. A missing wiki or database directory, missing/empty SQLite file, or
non-private/symlinked index boundary fails without allowing native startup to
recreate an empty replacement. At this checkpoint both directories absent was still the fresh-store
case. The accepted-corpus receipt below closes that total-loss gap for registered
corpora; neither check is a full consistency audit. The baseline isolated test demonstrated that native startup recreated the
missing database before the read/recovery failed. The treatment prevents that
mutation. Four real-engine cases preserve the damaged fixture, reject recovery,
then recover current and historical content after the original files are put back.

The lifecycle harness is separate because upstream restore/reindex refuse when
any other ai-memory process is active. Run it without another qualification or
application memory worker running:

```sh
pnpm exec tsx scripts/ai-memory-lifecycle-acceptance.ts /absolute/path/to/ai-memory
```

Only temporary synthetic corpora are used. The macOS arm64 2.4.1 executable
passed live backup, live-writer refusal, failed restoration into quarantine with
the original unchanged, restoration of current and superseded content, and Git
commit preservation. Reindexing a separate copy of just the Markdown recovered
the current note, but not its superseded Cedarbay excerpt. These are seven
qualified contracts; the JSON report also records blockers and pending work.

**Do not run `restore --force` over an occupied 2.4.1 corpus.** Our first corrupt
archive test failed: native restore had already changed the destination database.
The [released implementation](https://github.com/akitaonrails/ai-memory/blob/v2.4.1/crates/ai-memory-cli/src/commands/restore.rs)
removes the existing wiki/database before validating the archive. The safer
staging implementation documented on main is not in this release. As checked on
2026-09-28, [2.4.1 remains the latest stable release](https://github.com/akitaonrails/ai-memory/releases/tag/v2.4.1).
The repeatable acceptance therefore restores only into a new private directory
and verifies that the original remains byte-identical. Native extraction also
produces 0644 files despite a private umask: group/other permissions are removed
inside quarantine before the Zoen adapter opens the restored corpus. This is an
operator qualification, not an exposed restore endpoint or an implemented atomic
promotion workflow.

Production backups still need live owner authorization, coordination with raw
Eve sources and PostgreSQL receipts, retention/erasure rules, volume placement,
recoverable promotion and capacity tests. A native corpus archive is not a full
account backup. Dreams remain off until their provider, isolation, cancellation,
evidence and undo contracts are implemented and verified.

Validation: all nine workspace checks pass (1,323 tests in 205 files), as does
the production build. The isolated learned-memory suite passes 14 cases,
including the four damaged-corpus cases; the existing upstream harness passes
17 contracts and the lifecycle harness passes the seven contracts above with
its in-place restore blocker retained. The structural delta for this change has
no gating regressions and one unsuppressed minor recent-edit finding. This is
not a clean structural assessment of earlier commits or production recovery
qualification. No production data, migration or deployment was changed.

Chrome reopened the local companion after the build, loaded both existing
fictional Cedarbay notes and retained the saved relationship. The screenshot
records this normal read path; the damage/restore behavior is established by
the isolated filesystem/runtime tests, not by that screenshot.

## Accepted corpus receipts and total-loss protection, 2026-09-28

Each person/workspace namespace now records two independent initialization receipts
in PostgreSQL: learned notes and the native session corpus. Successful authorized
reads/operations accept that corpus under the existing namespace lock. A first
learned-note mutation accepts and verifies its initial corpus in the durable fence
transaction before the mutation starts, so a failed first write cannot roll back
the receipt and make a later total loss look like an unused memory.

A registered corpus must have its original private wiki and SQLite index before
any directories/configuration are created or the native process starts. Loss of the
whole corpus, person namespace, or configured volume therefore fails closed. Clear
keeps the receipt; explicit recovery requires existing files even without a receipt.
Session delivery retains its queued sources when an accepted corpus disappears.
Restoring the original test files allows retry with current and superseded content
intact. No automatic empty replacement, reindex, or in-place restore is attempted.

These receipts are metadata, not a second memory source. Migration 0080 defaults
them to false; a healthy existing corpus becomes protected when first accepted by
the new application. Previously lost, unregistered corpora cannot be distinguished
from a fresh namespace. Raw JSONL has its existing export integrity checks, but this
receipt does not independently detect loss of raw files while native memory is
unconfigured, a valid-looking stale volume replacement, or simultaneous loss/rollback
of PostgreSQL and storage. Coordinated backup, restore promotion and capacity remain
unqualified.

The shared memory view distinguishes load failures from unconfirmed changes,
labels any previously loaded notes, and disables actions until access is verified.
A failed load never shows the empty-memory invitation. Chrome verified the actual
local application using one clearly named synthetic workspace: the original
namespace was moved aside under its database lock, both desktop modal and mobile
sheet showed the failure, and restoring those exact files followed by retry restored
the note. No personal data or hosted records were changed.

Validation: the baseline adapter silently returned an empty list after total loss;
the new seven failure cases pass in a 37-test isolated real-engine run covering
learned notes and session archives. The upstream acceptance and quarantined lifecycle
harnesses pass (17 and 7 contracts). CI now builds the shared contracts before runtime
tests, installs the checksum-verified pinned native engine from the production Docker
stage, and runs those harnesses. The obsolete job targeting the removed Mem0 source
was replaced while retaining PostgreSQL backup recovery. This does not authorize a
hosted Mem0 data cutover or erase its outstanding retention/erasure obligations.

Final local checks passed all nine workspace tasks (1,323 tests / 205 files), the
production build, migration-chain validation, and Expo exports for web, iOS and
Android. Six additional isolated checks passed for compiled Eve restart/session
capture and save/removal/revocation races. Screenshots are attached using `gh --attach` in
[PR 148](https://github.com/EnzoTironi/tryzoen/pull/148#issuecomment-5870198438).
The structural delta has ten unsuppressed gating findings: recent memory-engine
churn, the existing learned-notes component growing from complexity 25 to 28 and
264 to 274 lines, and the longer runtime CI job. No clean structural-quality claim
is made. These migrations and simulations ran only on local isolated/review data;
production rollout and fresh remote CI remain separate checks.

## Fair session delivery and durable retry — 2026-09-28

Session delivery now commits each namespace independently. One dispatch visits at
most five distinct authorized namespaces and acknowledges at most 25 sources per
namespace. A successful account remains committed if a later account fails. The
native Akita engine, immutable source files, digest checks and corpus-acceptance
receipts remain the existing owners; this adds no secondary queue service.

The pending index orders sources by `available_at` and capture sequence. A
successful batch moves its remaining sources behind accounts already waiting.
Every source in that namespace receives the same statement timestamp; capture
holds the namespace lock and inherits the oldest pending source's eligibility.
A new event therefore cannot bypass earlier failed events. The per-namespace
index preserves capture order within a batch. Existing limits of 1,000 pending
records and 8 MiB per namespace bound the rescheduling update.

A savepoint rolls back the failed batch's database acknowledgements while its
outer namespace/membership locks remain held. Retry eligibility is persisted for
the whole pending namespace: 60 seconds, then exponential delay up to one hour.
The oldest attempted source retains its failure count and last failure time;
raw exception text and private file content are not copied into diagnostic
columns. Files written before a failed batch remain immutable and are verified
on replay. After attempting other accounts, an aggregate error keeps the schedule
failure visible with the count stored successfully. Cancellation or a failed
outer database commit does not acknowledge delivery.

`SKIP LOCKED` permits another dispatcher to make progress on a different account.
Organization membership is also checked and locked for team scopes; a leftover
workspace membership after organization revocation cannot authorize ingestion.
Personal pause, account deletion and workspace membership fences remain in place.
These queue locks follow PostgreSQL's documented [locking clauses](https://www.postgresql.org/docs/current/sql-select.html#SQL-FOR-UPDATE-SHARE);
[statement timestamps](https://www.postgresql.org/docs/current/functions-datetime.html#FUNCTIONS-DATETIME-CURRENT)
keep one batch's priority stable, unlike a clock value evaluated separately for
each row.

Migration 0091 adds delivery metadata and replaces only the two pending indexes.
It does not rewrite the applied chain, reset data, import already acknowledged
sources or initialize lost corpora. Apply it before deploying the new worker.
Large-table migration locking and production query plans still need qualification.

Operational checks should track the age/count/bytes of eligible pending sources,
accounts in backoff, repeated failures, batch duration and acknowledged throughput.
`delivery_failures`/`last_failed_at` describe failed batch attempts associated with
the queue head, not failed model answers. Repair storage/integrity first; the
next eligible retry uses ordinary replay. Do not clear receipts, fabricate a
fresh accepted corpus or edit private source bodies to make delivery appear done.

Run the reproducible local measurement alone, after the isolated runtime services
are started and migrated:

```sh
node --env-file=tests/runtime/.env.example --import tsx scripts/session-archive-capacity.ts --binary /tmp/zoen-ai-memory-runtime/ai-memory --accounts 20 --sources 25 --workers 4 > /tmp/archive-capacity.json
```

The command accepts only the isolated loopback database, requires no pending
sources, creates private disposable corpora, runs the actual Akita executable,
verifies every account's receipts and disposes only its own fixtures. `--help`
documents workload bounds. The JSON reports elapsed time, dispatch percentiles,
throughput and parent-process resource usage; it explicitly excludes PostgreSQL
and native child-process memory. It does not reset a database.

This is bounded, fair delivery, not a production capacity result. Each dispatcher
processes at most 125 sources. Large accepted corpora, paused/revoked backlog query
plans, shared-volume placement, host loss and production latency/backlog SLOs
remain release gates.

Local comparison recorded in [the JSON report](evidence/session-delivery-2026-09-28.json):
20 accounts × 25 sources, Node 24.21.0 on macOS arm64, local PostgreSQL and real
Akita 2.4.1. With no concurrent test/build command, one worker acknowledged all
500 sources in 10.87 seconds (46.0/s); four workers took 6.43 seconds (77.8/s).
Dispatch p95 increased from 2.77 to 6.43 seconds as workers shared resources.
This is one small sample per configuration, with fresh private corpora. It proves
receipt completion under this workload and motivates further measurements; it
does not set a default production concurrency, qualify the cron cadence or cover
large historical indexes, inactive-account scans, peak child RSS or network disks.

Verification: all 405 isolated runtime tests in 104 files passed after this queue
change. The five new tests cover isolation/backoff/replay, bounded fairness,
concurrent dispatch, locked accounts and residual organization membership.
Existing corpus-loss, acknowledgement rollback, pausing and erasure tests continue
to pass with the real native engine. Application checks passed 1,591 tests in 259
files, types, lint, formatting and unused-code checks. Migration validation passed.

### Bounded scheduled delivery

The Eve minute schedule starts up to eight dispatch rounds. It stops starting
rounds after 45 seconds or once every worker reports no eligible work. Active
transactions are always awaited; the time budget is not a hard timeout that can
leave a file write or native ingestion running without an owner. The existing
engine timeout and rollback/replay path still govern individual failures.

`ZOEN_MEMORY_INGESTION_CONCURRENCY` is validated at startup (1–4, default 1). The
default retains the previously deployed single-dispatcher resource footprint
while permitting multiple fair rounds within one tick. Raising it requires
measuring database connections, native child RSS and the persistent volume.
The local four-worker sample is evidence for testing an override, not a default
production capacity assertion.

Overlapping invocations share the active promise in one runtime process and
receive its same success or failure. This is a local resource bound; replicas
remain independent and their aggregate concurrency must be budgeted operationally.
The existing PostgreSQL locks prevent simultaneous ingestion of one namespace.
Each round waits for all workers, continues useful work after a damaged account
backs off, and reports collected failures after the bounded work completes.
There is no separate queue framework or detached background promise.

Seven unit scenarios exercise coalescing, concurrency, empty queues, failures and
budgets. The real-engine isolated test queues 175 sources across seven healthy
accounts plus one damaged account: one scheduled invocation acknowledges all
healthy sources, retains the damaged batch with one retry increment and reports
the failure. This does not qualify production cron latency or host-loss recovery.
