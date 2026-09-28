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
