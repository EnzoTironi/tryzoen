# Knowledge and ontology — implementation contract

Reviewed 29 September 2026 against the current code and the supplied v2.2 ontology specification. The user identified TextQL as the primary ontology reference and questioned retaining two knowledge systems. The target below supersedes the earlier decision to retain Akita as a permanent owner. The user also confirmed greenfield status: no launched product, production users or production data; no legacy-data conversion is required. This does not reopen creator marketplace work.

## Decisions

- Target one knowledge system for authored ontology, learned claims and retained sessions. Replace the current Akita 2.4.1 implementation directly with the unified file-backed owner and update callers/tests together. Existing development corpora may be recreated; do not build an Akita history importer. Preserve the product behaviors in the new design, not the old implementation. Dreams require source-edit and erasure safety before activation. Do not maintain parallel authoritative memory copies or add dual-write compatibility paths.
- TextQL is the product and workflow reference; Akita supplies behavioral lessons, not the permanent architecture. A semantic compiler is an execution dependency, not another knowledge authority.
- Keep Eve for execution and approvals, PostgreSQL for identities/grants/product records, Matrix for communication and Kernel for the browser. Opening chat must not start an analytics engine or VM.
- Ontology definitions are authored files at a published Git revision. Object IDs survive labels and paths. Any graph/search projection names its source revision and cannot grant access.
- Do not build a TQL interpreter or universal semantic language. Use a maintained semantic compiler in its native format. Temporal claims and analytic metrics have different owners.
- World-valid time is explicit source evidence, not inferred from ingestion timestamps. Akita `as_of` is ingestion-time history and must not be presented as complete bitemporality.
- Shared knowledge receives explicit publication/grants. A private conversation, hidden Git history or credentials cannot accompany a shared document by accident.

## TextQL reference and Zoen acceptance contract

The [TextQL ontology product](https://textql.com/products/ontology) describes a
versioned file tree containing definitions, supporting context and generated apps,
with reviewed patches and actions bounded by the same access model. Its public
[skills](https://github.com/TextQLLabs/skills/tree/31123f39645d3b7872319ee8b304dae0f0f0a12f/ontology/skills-pack)
provide conversational recipes, small routing indexes and scope-specific canonical
definitions. The [starter kits](https://github.com/TextQLLabs/ontology-starter-kits/tree/72c9a5df9da1e52f094a7faf80d3eb5aebbc653e)
seed discovery from domain knowledge and real questions; they are not an already
validated model of a user's data. These are research references, not installed
skills or an available open-source TextQL runtime.

For Zoen this means:

- **One user-owned knowledge tree.** Sessions, claims, definitions, relationships,
  evidence, procedures and generated artifacts use one publication/access
  contract. Personal, group and organization scopes select visibility; they do
  not select separate memory products. Live source data stays at its source
  unless an authorized import explicitly snapshots it.
- **Conversation drives authoring.** Start from connected evidence and the
  user's intended decisions. Propose a short purpose document and useful
  questions; ask only for unresolved meaning. Do not require users to learn a
  modeling language or fill in schema forms.
- **Read, discover, answer, propose.** Load authorized published definitions
  first. Explore the missing part, cite the evidence and propose reusable
  knowledge. Answering a question does not silently approve its new definition.
- **Scoped routing.** Small indexes point to canonical records loaded on demand.
  Indexes, links, search snippets and historical views cannot reveal private
  names or paths. Two teams may define a term differently; reconciliation is an
  explicit attributed relationship, not an accidental merge of their memories.
- **Reviewed publication.** A proposal includes related files, evidence and
  dependencies at one base revision. Review, accept or reject the complete diff;
  concurrent edits and access revocation must prevent stale publication.
  Agent-produced prose cannot grant permissions.
- **Reuse beyond answers.** Reports, routines, skills and apps refer to published
  definitions by stable ID and revision. Known-result checks qualify computation;
  answers identify their source revision and freshness. Git remote synchronization
  and external editing remain planned, not implemented by today's bundle export.

No upstream pack was copied or activated. The skills repository has no root
software license in the inspected tree; the starter-kits LICENSE documents
code-system vocabulary restrictions rather than establishing a blanket software
license. Reuse of vendor files requires an explicit applicable grant. The
implementation contract above is Zoen's own adaptation of the product pattern.

## Unified filesystem and memory target

Durable files are the knowledge authority. Search, embeddings and graph/SQLite
projections are derived, principal-scoped and rebuildable from a declared file
revision; no projection can create visibility. PostgreSQL remains authoritative
for accounts, memberships, access and execution receipts. Matrix remains the
message transport. Those owners are not competing knowledge stores.

A session journal must retain original event identity, author, source, ordering
and receipt links under the conversation's access boundary. Large attachments
need bounded blob references and lifecycle rules rather than oversized Git
commits. Learned claims must record evidence, attribution, known-time history,
explicit valid-time when established by evidence, and correction/erasure lineage.
A current Markdown summary alone cannot reconstruct those facts.

The retained filesystem needs atomic publication or a recoverable publication
journal: fencing concurrent writers, crash recovery, source/projected revision
checks, quotas, ownership placement and complete snapshot/restore. Do not replace
the current atomic bundle transaction with unrelated filesystem and SQL writes.
The project is greenfield. Replace the runtime owner and callers atomically,
remove obsolete Akita APIs/configuration/storage contracts, and recreate affected
development/test data where needed. No old-corpus converter, compatibility shim,
legacy alias, dual reads/writes or backfill is planned. Changing applied migration
history still requires resetting the affected local databases; consolidate a
baseline only as an explicit coordinated change, not incidentally. Revisit data
retention policy before the first production deployment.

Unified memory acceptance: search/retrieval, relations, historical `as_of`,
session-ingestion idempotency, source edits, deletion/tombstones, scope isolation,
export/restore and interruption recovery work against the new file authority. Bitemporal
claims add valid-time separately; missing dates remain unknown. Consolidation
reads a fixed source revision and writes a reviewable candidate, rechecking edits,
erasure and access before apply. It must not rewrite authored rules silently.

## Existing owners and actual gaps

| Capability                         | Current owner and evidence                                                                                            | Remaining change                                                                                                                                                                                                 |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ontology objects/relations/actions | `shared/workspaces/ontology.ts`, `server/workspaces/ontology.ts`; bounded typed graph and source revision validation  | Attributed claims, evidence at field/relation level, temporal history and shared native Library dossiers                                                                                                         |
| Published files                    | `server/workspaces/repository.ts` and `git.ts`                                                                        | Preserve existing CAS/idempotency when adding analytic files and multi-file proposals; do not introduce a second publisher                                                                                       |
| Atomic publication                 | Candidate Git bundle built before a PostgreSQL transaction atomically swaps head/bundle and appends operation receipt | Current bounded bundle design has no filesystem/DB split publication. A move to independent retained repositories needs fencing/journal recovery first; not required merely to add another document type         |
| Memory                             | `server/memory/ai-memory`, personal-memory authorization and namespace receipts                                       | Replace with unified file-backed claims/session owner; direct replacement without old-data conversion; scoped retrieval, new history/receipts, backup/restore, quotas and placement before safe candidate dreams |
| Ingestion                          | Durable bounded source files, receipts and per-namespace capture                                                      | Source correction/erasure propagation, attributed temporal claims, safe consolidation                                                                                                                            |
| Communication                      | Native Matrix ownership, scoped TanStack caches and delivery records                                                  | E2EE, push, public receipts, calls and full offline qualification remain in communications backlog                                                                                                               |
| Analysis                           | Existing typed ontology actions are property changes, not a semantic query engine                                     | Qualify compiler, authorized sources, constrained executor, provenance and revision-aware caching                                                                                                                |

The current repository stores bounded Git bundles in PostgreSQL (200 files, 256 KiB per file, 24 MiB bundle). It does not yet implement a persistent user filesystem or SQLite ontology projection. It already checks expected revisions, idempotent operation hashes and access again at commit. Replacing that transaction with two unrelated writes would regress durability.

## Ordered delivery

1. **K0 — engine decision:** projects/budget fixture with known totals, one-to-many joins, empty projects, two readers, parameters, permission denial and revocation. Record engine/runtime limitations before adding a production dependency. Initial executable findings are in [semantic-engine-review](semantic-engine-review.md).
2. **K1 — publishable knowledge:** extend the existing publisher to native model files, scoped routing/purpose documents and reviewable multi-file proposals. Preserve stable identity, exact revision, source provenance, conflict and authorization behavior. Files remain readable without compute.
3. **K2 — governed query:** execute one published definition against authorized CSV/bank data with typed arguments, bounded results, cancel/deadline, immutable execution manifest and current access revalidation. Expose through the existing chat/tool/card surfaces. No arbitrary connector credentials or unrestricted SQL in the client.
4. **K3 — complete memory contracts:** unified session/claim files, rebuildable retrieval projections, full corpus snapshot/restore with tombstones, attributed valid-time/known-time claims and bounded historical reads. Replace Akita directly with callers and behavior tests updated together; do not create a second memory system or fabricate dates.
5. **K4 — safe learning:** isolated dream candidate, source revision checks, review/apply/undo, durable receipts and interruption/erasure safety. No automatic rewriting of authored rules or published definitions.
6. **K5 — collaboration and execution:** Library dossiers and evidence, scoped proposals, document collaboration where needed; browser takeover and on-demand Linux remain capability adapters.
7. **K6 — analytics breadth:** exploratory work can propose reusable definitions; approved definitions feed reports, apps and Eve routines. Add connectors individually with actual revoke/error behavior.
8. **K7 — operations:** quotas, source freshness, cache revocation, backup recovery, load/cost measurements and platform qualification. Capacity claims require measured workload profiles.

Akita `as_of`, Git history and valid-time claims are different contracts. Analysis engine selection does not migrate memory; replacement is a direct greenfield rewrite within the unified knowledge plan. Creator interviews/marketplace expansion remain deferred. This plan records dependencies and acceptance boundaries; none of K1–K7 is marked complete by the engine spike.

## K1 progress — native model source (29 September 2026)

The existing publisher now accepts `.malloy` only under `knowledge/models/`.
Native text is stored unchanged, with the same CAS, operation receipt, history,
workspace access and Git bundle export as authored knowledge. The shared Library
adds an analysis-model category and a conversational creation entry; file editors
use their source-text mode rather than converting models through Markdown.
No compiler is loaded by chat or file reads, and storing source does not qualify
its syntax, sources, imports or execution. Those gates remain in K2.

A real isolated PostgreSQL/Git test proves exact content, historical reads,
replay, conflict, member access, personal/team isolation and standalone bundle read.
This is the first K1 slice, not completion: reviewed multi-file proposals, stable
model identity across moves and per-field provenance still require implementation.
The filesystem remains the bounded transactional Git-bundle design described
above; no retained user volume or SQLite ontology projection was introduced.

The running local production build also verifies Library filtering, exact source
editing, saved revision reload and historical preview in Chrome. The editor
surface can shrink on mobile so long filenames do not push actions off-screen.
This is browser verification, not physical Expo-device qualification.
