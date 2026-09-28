# File-based memory: Akita and Muse

## Accepted direction, 2026-09-28

The user selected Muse's readable files and [Fabio Akita's ai-memory](https://github.com/akitaonrails/ai-memory), including persisted sessions, dreaming, relations and temporal recall. This supersedes the previous decision to retain Mem0 as the target learned-memory system. Mem0 and Eve's current profile adapter still run today; this document does not claim they have been replaced. Remove them with their complete replacement slices and callers, without a fallback or dual-write migration.

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

The harness uses disposable synthetic stores and explicit configuration. It does not install hooks, touch Zoen databases, inherit provider secrets or enable dreams. Test directories and a JSON report remain available for inspection. This proves engine behavior, not deployed integration, Zoen authorization, historical reconstruction after index loss, dream quality or capacity. The report lists pending gates explicitly.

## Eve source capture — 2026-09-28

Implemented behind `ZOEN_SESSION_ARCHIVE_DIR`, an absolute directory on a persistent, private POSIX filesystem. It is configured only for local review; a Vercel temporary directory is not a deployment target. Hooks capture visible `message.received`, `message.completed` and turn completion/cancellation/failure coordinates. Framework background inputs, reasoning, tools and provider payloads are excluded. Known credential patterns are redacted before the delivery queue, without claiming perfect recognition of arbitrary secrets.

PostgreSQL holds a bounded outbox (1,000 pending events and 8 MiB of encoded JSONB per private namespace), stable event hashes and a monotonic capture sequence. Ownership is checked against the persisted Eve session. The minute schedule delivers at most 25 events, rechecks live membership under a lock and publishes immutable `0600` JSONL files in `0700` directories under `<root>/<namespace UUID>/raw/eve/<session hash>/<event hash>.jsonl`. Each line retains the original session/event IDs, segment index/count and timestamps; the capture sequence orders delivery independently of wall-clock/event-ID sorting. Content leaves the outbox only after filesystem sync. Retries compare exact existing bytes, including after a database acknowledgement rolls back. Namespace erasure removes its Eve raw subtree through the existing durable erasure receipt.

This is a source record, not authoritative accepted assistant history: retried Eve attempts remain distinguishable and assistant blocks carry `settlement: unverified`. Version 2 source files preserve complete redacted messages up to 1 MiB, split into ordered JSONL segments of at most 2,048 UTF-16 code units without splitting surrogate pairs. Oversize messages fail explicitly instead of being truncated; redaction occurs before segmentation. Attachment sources, source retention/export, recall suppression after selective forgetting, assistant settlement and production delivery throughput are still required. The qualified local worker described below can now ingest new user sources into Akita. No dreams run. Pausing memory blocks capture and queued delivery until resumed; it does not erase previously captured conversations.

Initial capture evidence (before the ingestion extension below): three filesystem tests and five isolated PostgreSQL/filesystem integration tests cover private permissions, traversal/symlink rejection, repeated delivery, durable acknowledgement rollback, bounded batches, revoked membership and account erasure fencing. A synthetic browser conversation on the current Eve runtime produced user/assistant/turn files through the real schedule dispatch and retired all three outbox payloads. Eve development schedules require explicit dispatch; the production cron is not exercised by that local dispatch. A previous development session whose compiled snapshot was already absent could not resume; this is not evidence of production restart recovery.

## Qualified local Akita ingestion — 2026-09-28

`ZOEN_AI_MEMORY_BINARY` enables the official **2.4.1** executable in the session delivery worker when `ZOEN_SESSION_ARCHIVE_DIR` is configured. This is a local/persistent POSIX worker, not a deployed replacement for learned-memory recall. The binary must be independently checksum-verified. `uuid` 14.0.2, the current stable registry release at implementation time, supplies RFC UUIDv5 identities; the existing MCP SDK supplies the client transport.

The worker opens `<root>/<namespace UUID>/ai-memory` with its own `wiki`, Git history and derived index. A namespace lock serializes workers and fences membership revocation/account deletion while the engine is alive. One engine is open at a time in each bounded worker batch. It binds an OS-selected loopback port with a random per-process bearer token, inherits no application/provider credentials, and pins a private configuration with embeddings and dreams disabled. Upstream's own data-directory lock remains in force. The generic MCP connection and its authority stay behind the server boundary. Rooms and published bots are not mapped into these personal stores.

The supported **`POST /hook/batch`** endpoint processes events inline. Zoen validates individual acknowledgements and then reads bounded, scope-specific observation pages to verify each segment's source marker and Eve provenance. A successful HTTP response alone is insufficient: upstream can acknowledge deliberate policy drops. Stable ingestion keys and persisted segment markers allow retries after a lost response or process restart to skip already stored source segments. Turn-end delivery is replayed to finish downstream summary effects. Files remain immutable, and outbox content is cleared only after disk synchronization plus verified ingestion when enabled.

Each Eve turn maps to its own upstream session using its private namespace, session ID and turn ID. User text uses the supported `other` agent plus `eve` extension; there is no Claude/Codex impersonation. Turn completion, failure or cancellation closes that source session and produces upstream's zero-LLM episodic summary. This summary is not a distilled fact database or a dream. Assistant stream attempts remain in raw files with `settlement: unverified` and **are excluded from ingestion** until public Eve APIs can identify accepted history. Thus this is not full conversation-memory parity yet.

Account/namespace erasure removes both `raw/eve` and its derived `ai-memory` directory, including that directory's local Git/index files. The existing external erasure receipt still tracks other memory providers. This does not assert deletion of external backups or snapshots. Sources already delivered before enabling the engine are not automatically imported.

Fresh verification: four filesystem tests; eight isolated PostgreSQL tests also run against the real executable; 16 upstream acceptance contracts including partial-delivery acknowledgement loss, restart deduplication, source-to-Git-versioned-Markdown, private-directory isolation and erasure. The acceptance harness uses synthetic data only and retains a JSON report. A separate IPC-bound supervisor terminates the engine when its application owner disconnects, including SIGKILL, with one second of graceful shutdown before forced termination and a 15-minute absolute lifetime. The crash test kills the actual owner process, proves a competing writer is refused before the crash, and then reopens the same store and recalls the committed note without force-unlocking. It does not prove recovery after the supervisor itself is killed, host/volume failure, dreaming or production placement.

Browser verification used an ordinary synthetic conversation after rebuilding/restarting the local runtime. Its Rosehaven turn produced three upstream observations (session start, user input and turn end), a readable Markdown summary, and three retired outbox payloads. The archived start/end times remained `2026-09-28T04:56:22.616Z` and `2026-09-28T04:56:26.205Z`; assistant text stayed raw-only. This caught and corrected a start-time bug that used delivery time. The previous running backend did not hot-reload that module, so the final check used a fresh process. `pnpm check` passed 1,318 tests across 203 files, and `pnpm build` passed.

Remaining deployment work: qualify host/container supervision and volume recovery, choose persistent-volume placement and tenant quotas, measure throughput/fairness under backlog and failures, keep paused namespaces from learning, qualify backup/restore/retention and selective forgetting, then replace Mem0's complete product surface. The current 25-event minute batch is a bounded delivery implementation, not a million-account capacity result. The structural review retained a 19-point receipt-validation function for its explicit fail-closed checks; the redaction helper export also triggers the tool's historical-churn heuristic. These are recorded tradeoffs, not a claim of a clean structural gate.
