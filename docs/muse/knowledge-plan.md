# Knowledge and ontology — implementation contract

Reviewed 29 September 2026 against the current code and the supplied v2.2 ontology specification. This expands the existing backlog; it does not reopen creator marketplace work.

## Decisions

- Keep real Akita 2.4.1 for current learned memory and session ingestion. Its SQLite history and receipts are not reconstructible from Markdown alone. Back up the complete corpus. Do not enable its live dream scheduler while the reproduced edit/deletion races remain.
- Keep Eve for execution and approvals, PostgreSQL for identities/grants/product records, Matrix for communication and Kernel for the browser. Opening chat must not start an analytics engine or VM.
- Ontology definitions are authored files at a published Git revision. Object IDs survive labels and paths. Any graph/search projection names its source revision and cannot grant access.
- Do not build a TQL interpreter or universal semantic language. Use a maintained semantic compiler in its native format. Temporal claims and analytic metrics have different owners.
- World-valid time is explicit source evidence, not inferred from ingestion timestamps. Akita `as_of` is ingestion-time history and must not be presented as complete bitemporality.
- Shared knowledge receives explicit publication/grants. A private conversation, hidden Git history or credentials cannot accompany a shared document by accident.

## Existing owners and actual gaps

| Capability                         | Current owner and evidence                                                                                            | Remaining change                                                                                                                                                                                         |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ontology objects/relations/actions | `shared/workspaces/ontology.ts`, `server/workspaces/ontology.ts`; bounded typed graph and source revision validation  | Attributed claims, evidence at field/relation level, temporal history and shared native Library dossiers                                                                                                 |
| Published files                    | `server/workspaces/repository.ts` and `git.ts`                                                                        | Preserve existing CAS/idempotency when adding analytic files and multi-file proposals; do not introduce a second publisher                                                                               |
| Atomic publication                 | Candidate Git bundle built before a PostgreSQL transaction atomically swaps head/bundle and appends operation receipt | Current bounded bundle design has no filesystem/DB split publication. A move to independent retained repositories needs fencing/journal recovery first; not required merely to add another document type |
| Memory                             | `server/memory/ai-memory`, personal-memory authorization and namespace receipts                                       | Complete retained-volume backup/restore, quotas and placement before safe candidate dreams                                                                                                               |
| Ingestion                          | Durable bounded source files, receipts and per-namespace capture                                                      | Source correction/erasure propagation, attributed temporal claims, safe consolidation                                                                                                                    |
| Communication                      | Native Matrix ownership, scoped TanStack caches and delivery records                                                  | E2EE, push, public receipts, calls and full offline qualification remain in communications backlog                                                                                                       |
| Analysis                           | Existing typed ontology actions are property changes, not a semantic query engine                                     | Qualify compiler, authorized sources, constrained executor, provenance and revision-aware caching                                                                                                        |

The current repository stores bounded Git bundles in PostgreSQL (200 files, 256 KiB per file, 24 MiB bundle). It does not yet implement a persistent user filesystem or SQLite ontology projection. It already checks expected revisions, idempotent operation hashes and access again at commit. Replacing that transaction with two unrelated writes would regress durability.

## Ordered delivery

1. **K0 — engine decision:** projects/budget fixture with known totals, one-to-many joins, empty projects, two readers, parameters, permission denial and revocation. Record engine/runtime limitations before adding a production dependency. Initial executable findings are in [semantic-engine-review](semantic-engine-review.md).
2. **K1 — publishable knowledge:** extend the existing publisher to native model files and reviewable multi-file proposals. Preserve stable identity, exact revision, source provenance, conflict and authorization behavior. Files remain readable without compute.
3. **K2 — governed query:** execute one published definition against authorized CSV/bank data with typed arguments, bounded results, cancel/deadline, immutable execution manifest and current access revalidation. Expose through the existing chat/tool/card surfaces. No arbitrary connector credentials or unrestricted SQL in the client.
4. **K3 — complete memory contracts:** full corpus snapshot/restore with tombstones, then attributed valid-time/known-time claims and bounded historical reads. Compare a limited upstream extension before replacing Akita. Do not fabricate dates.
5. **K4 — safe learning:** isolated dream candidate, source revision checks, review/apply/undo, durable receipts and interruption/erasure safety. No automatic rewriting of authored rules or published definitions.
6. **K5 — collaboration and execution:** Library dossiers and evidence, scoped proposals, document collaboration where needed; browser takeover and on-demand Linux remain capability adapters.
7. **K6 — analytics breadth:** exploratory work can propose reusable definitions; approved definitions feed reports, apps and Eve routines. Add connectors individually with actual revoke/error behavior.
8. **K7 — operations:** quotas, source freshness, cache revocation, backup recovery, load/cost measurements and platform qualification. Capacity claims require measured workload profiles.

Akita `as_of`, Git history and valid-time claims are different contracts. Analysis engine selection does not migrate memory. Creator interviews/marketplace expansion remain deferred. This plan records dependencies and acceptance boundaries; none of K1–K7 is marked complete by the engine spike.
