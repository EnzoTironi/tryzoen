# Knowledge and ontology — implementation contract

Reviewed 29 September 2026 against the current code and the supplied v2.2 ontology specification. The user identified TextQL as the primary ontology reference and questioned retaining two knowledge systems. The target below supersedes the earlier decision to retain Akita as a permanent owner. The pre-launch preference permits direct removal of obsolete interfaces and atomic caller updates. Data-destructive resets and migration-baseline consolidation require specific coordinated authorization. The current repository policy is greenfield and supersedes the 19 September persistent-rollout assumption. This plan does not authorize destructive migration, deletion of hosted records, credential use or deployment. This does not reopen creator marketplace work.

## Decisions

- Target one knowledge system for authored ontology, learned claims and retained sessions. Replace the current Akita 2.4.1 implementation directly with the unified file-backed owner and update callers/tests together. Do not build an Akita history importer or infer permission to reset existing corpora. Preserve the product behaviors in the new design, not the old implementation. Dreams require source-edit and erasure safety before activation. Do not maintain parallel authoritative memory copies or add dual-write compatibility paths.
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

- **One file-backed knowledge system.** Distinct visibility scopes require distinct repositories; private `(workspace, user)` claims and sessions must never enter a shared bundle, export, history or router. Sessions, claims, definitions, relationships,
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
Replace the runtime owner and callers atomically,
remove obsolete Akita APIs/configuration/storage contracts. Recreating affected
development/test corpora requires specific coordinated reset authorization. No old-corpus converter, compatibility shim,
legacy alias, dual reads/writes or backfill is planned. Changing applied migration
history still requires resetting the affected local databases; consolidate a
baseline only as an explicit coordinated change, not incidentally. Destructive changes to hosted records require separate explicit authorization;
greenfield architecture is not authorization to delete hosted data.

Unified memory acceptance: search/retrieval, relations, historical `as_of`,
session-ingestion idempotency, source edits, deletion/tombstones, scope isolation,
export/restore and interruption recovery work against the new file authority. Bitemporal
claims add valid-time separately; missing dates remain unknown. Consolidation
reads a fixed source revision and writes a reviewable candidate, rechecking edits,
erasure and access before apply. It must not rewrite authored rules silently.

## Existing owners and actual gaps

| Capability                         | Current owner and evidence                                                                                                                       | Remaining change                                                                                                                                                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ontology objects/relations/actions | `packages/companion-ui/src/library/ontology/schema.ts`, `server/workspaces/ontology.ts`; typed graph, scoped citations and world-valid intervals | Learned-claim/session replacement, complete bitemporal history and conversational corrections                                                                                                                    |
| Published files                    | `server/workspaces/repository.ts` and `git.ts`                                                                                                   | Preserve existing CAS/idempotency when adding analytic files and multi-file proposals; do not introduce a second publisher                                                                                       |
| Atomic publication                 | Candidate Git bundle built before a PostgreSQL transaction atomically swaps head/bundle and appends operation receipt                            | Current bounded bundle design has no filesystem/DB split publication. A move to independent retained repositories needs fencing/journal recovery first; not required merely to add another document type         |
| Memory                             | `server/memory/ai-memory`, personal-memory authorization and namespace receipts                                                                  | Replace with unified file-backed claims/session owner; direct replacement without old-data conversion; scoped retrieval, new history/receipts, backup/restore, quotas and placement before safe candidate dreams |
| Ingestion                          | Durable bounded source files, receipts and per-namespace capture                                                                                 | Source correction/erasure propagation, attributed temporal claims, safe consolidation                                                                                                                            |
| Communication                      | Native Matrix ownership, scoped TanStack caches and delivery records                                                                             | E2EE, push, public receipts, calls and full offline qualification remain in communications backlog                                                                                                               |
| Analysis                           | Existing typed ontology actions are property changes, not a semantic query engine                                                                | Qualify compiler, authorized sources, constrained executor, provenance and revision-aware caching                                                                                                                |

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

## K1 progress — reviewed multi-file publication (29 September 2026)

The existing repository now publishes up to 24 file changes as one Git revision
and one PostgreSQL operation receipt. The receipt records every touched path;
history for each file points at the same publication. The Git staging contract
was replaced directly; individual editor saves compose the same publisher.
The workspace path/revision schemas now have one owner in the shared UI package,
used by server, web and Expo without a legacy re-export.

`workspace-knowledge-propose` stages a bounded JSON proposal in
`proposals/knowledge/`. A proposal includes its base revision, title, reason,
exact file changes, dependencies and citations. Authorized historical file
citations must contain the cited excerpt. The review checks current content
against the base for changed files, dependencies and cited workspace files.
Unrelated edits can coexist; changed sources block approval. Model/definition/
routing writes from the agent's generic save tool are denied. Requested ordinary
documents still use the direct save tool. Neither path executes an analysis model.

Library adds Review changes with the same React Native UI on web/Electron and
Expo: desktop modal, mobile sheet, current/proposed contents, file selection and
sources. Members can propose and inspect; administrators publish or reject.
Publication updates all files and removes the draft in one commit. Rejection
removes only the draft, retaining its historical version. The generic editor
cannot alter or remove a proposal. Decisions capture the exact displayed head,
recheck authorization, preserve durable operation IDs on retry and use the
existing CAS gate to prevent stale or partial publication. Initial proposal work
is restricted to private signed-in application conversations; group, delegated,
scheduled and external-channel proposal workflows are not qualified here.

Migration 0097 directly replaces `workspace_revision.path` with `paths[]` and
requires empty development workspace repository tables. The named isolated test
and local review databases were cleared only in those three disposable tables,
then migrated. No production database or provider deployment was touched. New
installations apply the coherent chain normally; existing disposable fixtures
must follow the coordinated reset in `local-runtime-setup.md`.

K1 remains open for stable identity across file moves, purpose/routing discovery
and field-level provenance. The retained filesystem, unified claim/session
owner, bitemporal queries, projections and safe consolidation remain K3/K4 work.
The actual memory runtime is still Akita; this slice supplies its replacement's
review/publication boundary rather than installing a second memory engine.

## K1 progress — scoped discovery and stable routing records

`knowledge/routing/index.json` is an authored file in the same published tree.
Its strict versioned schema contains up to 60 records: UUID, title, meaning,
search terms and up to three canonical knowledge paths. Record IDs stay with
the concept when its labels or paths change; a file move and routing update
publish together. The publisher rejects missing references in the resulting
tree, including a generic editor deletion that would break an existing route.
This is a small routing document, not a second graph or memory authority.

The native `workspace_knowledge_discover` reads the authorized purpose/routing
at one head, searches terms and returns at most 12 matching records. Loading up
to six returned IDs reads only their canonical files, with a 24,000-character
total excerpt budget and offsets for longer text. Reads detect head changes
instead of mixing revisions. IDs do not grant access: invisible references
remove the entire record, unknown IDs return no files and every read checks
current membership. No unpublished draft or private learned-memory corpus is
searched. More than 12 matches requires a narrower topic.

The workspace instructions now start domain discovery from published meaning,
distinguish files from live source data, and propose missing purpose/definitions/
routing as one reviewed change. Generic agent saves cannot publish purpose or
canonical routing. Actual native discovery, search/load bounds, unknown IDs,
cross-workspace isolation, record identity through a move, broken-reference
rejection and access revocation pass the isolated integration.

Stable IDs currently cover explicitly registered routing records. General
ontology field/relation provenance, private claim/session retention, historical
and valid-time retrieval, source erasure and reviewed consolidation still need
their unified owner. The Akita implementation remains active until that whole
contract and its callers can be replaced together; this slice does not add an
Akita importer, a dual writer or an alternate memory engine.

## K1 progress — evidence per property and relationship

Ontology property values now use one claim shape: value, exact source citations
and nullable world-valid interval. Links use the same citation and interval
contract. Each file citation contains its authorized workspace path, published
revision and exact excerpt. Publication validates the excerpt against that scoped
historical file; fabricated excerpts and foreign revisions are rejected. Reads
are bounded to 60 citations and 24 distinct source-file/revision pairs. Record
level citations remain distinct from field and link citations; they do not
automatically establish the source of every property.

A declared action replaces the complete claim. A manual value carries an empty
source list and unknown valid time rather than inheriting the previous value's
evidence. Dates require citations, are ISO calendar dates, allow open intervals,
and use an exclusive upper bound. No ingestion or publication date is substituted
for missing world-valid evidence. The native read tool accepts a published
`revision` and optional `validOn`. It can inspect the state known at that revision
and exclude explicitly out-of-range claims/links; unknown intervals remain
visible and must be described as unknown. Historical projections offer no actions.
This is a two-coordinate view of the bounded authored ontology, not complete
bitemporal learned-memory history or timestamp-based `as_of`.

Source status checks the quoted passage against current authorized files at a
declared `sourceCheckedAtRevision`. Passage-present does not attest that the whole
file is unchanged or that live provider data is fresh. Corrected passages and
unavailable sources are visible in the existing knowledge view. Citations open
their historical source. Administrators can attach evidence to the record, a
property or a relationship; quoted text and dates are preserved on validation
failure. The existing web view uses the local primitives and translations; a
shared native Library ontology dossier is still open.

The claim shape replaced primitive properties directly. Native tools, web forms,
synthetic fixtures and the approval evaluation consume the same schema; no
primitive-value compatibility reader was added. Disposable development ontology
documents using the former shape must be recreated. No production data was reset
and no deployment was performed. Explicit historical reads also reject a foreign
revision when the selected workspace has no repository. This complements the
existing receipt check for nonempty repositories.

Actual isolated integration covers scoped citations, property/link validity,
exclusive dates, historical state, current source correction/deletion, action
evidence replacement, invalid excerpts, access revocation and durable history.
Akita remains the learned-memory runtime until K3 replaces its complete owner;
semantic computation, private claims/sessions and dream review remain open.

## K1 progress — shared Library dossiers

The shared React Native Library now has a Knowledge category. Web/Electron and
Expo consume the same typed read adapter and canonical ontology schemas. The
former shared ontology schema file was removed; server validation errors remain
with their concrete server owner. No duplicate graph shape or compatibility
re-export was introduced.

A record opens in the existing responsive sheet/modal. Its fields retain their
own evidence and explicit validity intervals. Relationships open the related
record by stable object ID; inbound/outbound direction is shown. A citation opens
the historical source through the existing document-history adapter. Changed or
unavailable current passages remain visible as warnings. Missing citations and
unknown world-valid dates are stated explicitly rather than fabricated.

The collection uses principal/session-and-workspace-scoped TanStack keys, retains
its cached result during refresh, and removes records if revalidation fails.
Source previews use path/revision keys within that same scope. Search runs over
the bounded graph; at most 100 matching rows render and broader results ask for a
more specific search. File filtering runs only in the file collection, not when
a knowledge dossier or proposal collection is active.

This is the shared read/evidence journey, not a new authoring form. The existing
web administrator evidence editor remains available; conversational corrections,
full historical/date selection in the Library and unified private learned memory
still need their complete owner. No private session files, Akita dual writer,
semantic executor or provider-freshness guarantee was added.

## K1 progress — conversational ontology proposals

Private signed-in conversations can now stage the complete canonical ontology
alongside its definitions and models through the existing native proposal tool.
The shared path contract includes only `ontology/workspace.json` in addition to
knowledge files; drafts cannot delete the graph. Generic editor/agent writes
still cannot publish ontology, and only administrators can review it. The tool
also checks that the ontology capability is enabled.

Graph validation and every historical citation run before the draft is stored.
The proposal's graph citations are automatically included in its bounded source
set and base-versus-review comparison, even when the author omits them from the
proposal's separate evidence list. At most 24 distinct files and 24 file/revision
pairs can be referenced. A stale cited source blocks approval. Publication checks
the canonical graph and owned quotes at the repository boundary, then writes the
ontology, companion files and draft removal in one existing CAS publication.
Successful decision retries still return the original receipt.

The shared review renders records, claims, explicit validity, quoted evidence,
directional relationships and definitions from the canonical document. Records
and connections render in batches of 25 with a local expansion control. No
parallel ontology shape is stored. Review and list surfaces clear stale content
on failed authorization revalidation; publishing invalidates the scoped ontology
cache along with workspace files. Chrome verifies a two-file review/publication,
its new dossier without a reload, and the 390×844 mobile sheet.

Eleven isolated knowledge/ontology integration cases pass. The full required
check passes all nine tasks (282 files / 1,750 tests, 1m29.433s); the web/agent
build passes in 54.22s. The structural report retains five repeated-edit gates
and minor size/complexity observations; it is not a clean quality report.
No production deployment, database reset or new dependency was needed. This
provides the reviewed conversational authoring boundary, not a live-model
evaluation or replacement of private learned memory.

## K1 progress — recorded versions and validity in the shared Library

The shared Knowledge collection now opens the existing document history in a
mobile sheet or desktop modal. A reader may select a recorded Git version and,
independently, a world-valid date. No second history decoder or storage owner was
introduced. Historical views remain read-only; unknown validity stays visible,
invalid calendar dates cannot be applied and interval ends remain exclusive.

TanStack query keys include principal/workspace scope, recorded version and
validity date. The next view resolves before the sheet closes, so switching does
not relabel the old records or replace the collection with a loading screen.
Cached views are reused within the existing 15-second freshness window. Access
revalidation errors remove stale graph/history content. History remains bounded
to 50 versions and record search to 100 visible results.

Validation: full `pnpm check` passed nine tasks, 284 files / 1,752 tests in
50.757s; `pnpm build` passed in 40.643s. Two focused cache/transport tests cover
principal/date/revision separation and reuse of the document owner. Chrome
confirms invalid-date denial, an older label at the same record ID, desktop and
390×844 mobile controls, exclusive-end filtering and explicitly unknown dates.
Evidence is attached to PR 155. Disk exhaustion interrupted earlier attempts;
only regenerable caches under this worktree were removed before the successful
run. No user files or production records were removed.

This is revision-based history for authored ontology, not historical replacement
of the learned-memory engine. Timestamp selection is completed by the next step;
private claims/sessions, complete memory replacement and safe dream candidates
remain open.

## K1 progress — recorded timestamp selection

The existing native ontology read accepts `asOf`, an ISO timestamp with an explicit
timezone, independently of the world-valid `validOn` date. Exact revision and
timestamp selection are mutually exclusive in the single shared schema. A time
before the workspace's first publication returns no records rather than today's
facts. Timestamp and revision views are read-only, including one selecting the
latest revision. Current source-passage status remains explicitly attributed to
its own checked revision.

The published bundle and selected receipt are captured in one PostgreSQL MVCC
statement. A concurrent publisher cannot make the reader select a revision absent
from that bundle. Publication stamps its receipt at the final database write,
rather than transaction admission, and advances at least one microsecond past its
parent even if the clock moves backwards. Durable decision retries reuse that
receipt. No migration rewrite, alternate memory authority or historical backfill
was added. The existing current read retains its one-statement capture without an
extra history query.

Isolated tests exercise the real native tool, both time dimensions, explicit
unknown validity, exclusive interval ends, equivalent timezone offsets, an empty
pre-publication view, principal isolation and membership revocation. The clock
case checks late publication, replay and a controlled backwards-clock parent in
its own disposable fixture. The shared TanStack key now also includes `asOf`.
Required check passes all nine tasks, 284 files / 1,752 tests; the final repeat
reuses the successful task cache. Thirteen isolated ontology/knowledge cases and
the final two clock/read cases pass.

The final build passes in 45.42s. Chrome verifies the current strict read adapter,
switching to an older version and its valid date, and opening the cited dossier.
After the local review services stopped, this verification uses a fresh named
synthetic workspace in the isolated runtime database. The structural delta has
three repeated-edit gates and no new complexity or duplication finding; those
churn findings remain disclosed rather than suppressed.

This supplies timestamp history for authored knowledge. Learned private claims,
retained session replacement, semantic execution, dream candidates and measured
capacity remain open. Akita is still the learned-memory runtime until K3 replaces
that owner atomically.

## K1 progress — local recorded time in the shared Library

The same shared history sheet/modal now accepts a local day and minute and sends
a timezone-qualified `asOf` instant to the existing read owner. Selecting a Git
version clears the time; entering a time clears the version. Invalid dates and
nonexistent or repeated local times cannot fall back to current knowledge. The
selected local time survives reopening, remains separate from the valid date,
and appears in its dossier alongside the actual selected revision. A time before
the first publication shows an explicit empty-history state.

The next query still resolves before the view changes. Closing the history
control while it resolves prevents its late result from changing the foreground
view. History loading and version rows now belong to their own component, with
the existing 50-version bound and stale-content denial unchanged. No new engine,
picker dependency, schema alias or authoritative store was added.

Validation: nine required check tasks pass, 285 files / 1,756 tests in 2m33.48s;
the build passes in 35.225s. Four focused time cases verify local offset,
roundtrip, invalid input, daylight-saving gaps and repeated hours including a
30-minute clock change. Chrome verifies invalid-input denial, empty history,
the recorded-time dossier, reopening and returning to current knowledge, plus
the desktop modal and 390×844 mobile sheet. Images are attached to PR 155.
The structural delta retains a repeated-edit gate and minor size observations;
the new JSX component is also a call-graph indexing false positive, rather than
unused code. No finding was suppressed. These controls remain text inputs, not
physical-device qualification of a native calendar picker.

K2 semantic execution, K3 complete private memory replacement, K4 dream review
and capacity qualification remain open. This step completes the shared authored
knowledge time-selection journey, not complete Muse or learned-memory parity.

## K1 progress — historical canonical discovery and file reads

The native discovery and file-reading tools now use the same recorded-view
schema as ontology reads: exact revision or timezone-qualified `asOf`, never
both. Discovery selects that revision's purpose, routing and canonical paths,
so a later move does not erase the earlier definition. Follow-up reads and
pagination can pin the returned revision even after a concurrent current edit.
Historical missing files return `exists: false`; a time before the first
publication returns no purpose, records or content instead of today's files.
Historical files cannot activate procedures or grant access. Current missing
paths still fail normally. External agent grants cannot request any recorded
view, including an explicit current revision; revoked membership and foreign
workspace revisions remain denied.

Fourteen isolated runtime cases pass across discovery, publication time and
agent grants. They exercise the actual native schema/executor, moved paths,
revision-pinned pagination, empty history, account separation and revocation.
The dependency audit exposed three newly published `brace-expansion` advisories
in the previously green CI. The 2.x line uses patched 2.1.7; the affected 4.x
line requires 5.0.12, whose CommonJS export and Node 20/22+ support fit the
existing Node 24 toolchain. App and infrastructure audits now report no known
vulnerabilities. No audit exclusion or approval bypass was added.

This completes historical discovery for authored files; learned private memory,
session replacement, semantic execution and dreams remain in K2–K4.

Final validation: all nine required tasks pass (285 files / 1,756 tests,
2m6.65s); build passes in 1m24.881s. The focused rerun after the type fixes and
file-reader extraction passes four relevant runtime cases. The structural delta
retains discovery complexity/size and two repeated-edit findings; the file-read
behavior is now a private cohesive function rather than growing the dispatcher.
No metric waiver, test timeout increase or audit suppression was used.

## K1 progress — recorded file listings and literal search

Native file listing and knowledge search now accept the same recorded view as
discovery, ontology and file reads. Listings resolve paths at the selected
revision, including removed or moved files. Literal search runs against that
bundle and reports the selected revision; it retains three matching lines per
file, at most 60 excerpts, each bounded to 800 characters. Empty history returns
no files or matches. Private profile/instruction paths remain outside knowledge
search. Foreign revisions and revoked members cannot use either tool.

Recorded snapshot selection and access checks have one private repository owner,
shared by document selection and search inside their existing database
transactions. No new cache, query engine, schema alias, filesystem authority or
migration was introduced. Native tooling and instructions distinguish private
revision-pinned pagination from current-only shared execution: a group/external
agent checks each page's revision and restarts if it changes. Explicit recorded
selectors remain denied, including the current head.

Fourteen existing isolated runtime cases pass; the new native listing/search
case passes after correcting its fixture to use the existing separate profile
publisher. It verifies moved paths, literal brackets, clipping, pre-publication
absence, account separation, foreign revisions, invalid selectors and revoked
membership. Current-only external listing and paged reads remain operational.

Final checks: all nine tasks pass, 285 files / 1,756 tests in 1m2.063s; the
build passes in 24.032s. The final native file-view case passes in 7.33s.
The structural delta retains a repeated-edit dispatcher finding and a minor
eight-line size increase, without new complexity or duplication findings.

## K2 progress — bounded published computation (30 September 2026)

The native `workspace_knowledge_query` accepts one published query path, exact
Git revision and declared scalar arguments. It captures the definition, Malloy
model and declared CSV sources in one immutable Git reconstruction. Current
membership and head are checked again after calculation without retrieving the
bundle; a revoked reader or changed publication receives no answer or manifest.
Generic agent writes cannot publish analytic definitions/models/data, and broken
source references cannot be published or deleted through the repository.

Malloy 0.0.434 compiles inside a fresh PGlite 0.5.8 snapshot. The compiler has no
URL reader, network client, raw SQL source or undeclared table. Numeric CSV
values remain parameters; unsafe integer and decimal result values remain exact
strings. This is bounded published CSV computation, not live multi-provider SQL,
TextQL's proprietary runtime, a general sandbox or complete analytics parity.

The executor is a separate credential-free container, not a child sharing the
application's memory boundary. Startup rejects non-Linux, unbounded cgroup v2
memory, a limit above 1536 MiB, or enabled swap. Each capsule admits one worker;
the application admits at most two calculations. The configured per-job upper
bound includes WASM/native allocation, with a 3 GiB maximum for two capsules.
Deadlines remain independently 15 seconds; inputs are 1 MiB, results plus their
manifest 64 KiB and at most 100 rows. Cancellation waits for child termination
before admission is reusable. No host security configuration was changed.

A credential-free empty database template avoids repeated initdb initialization;
valid inputs are loaded in parameterized 200-row chunks (at most 6000 parameters
with 30 columns). The template contains no imported facts and is rebuilt with
the pinned engine. Authoritative query/model/data files and current access remain
outside the executor. No second knowledge authority or result cache was added.

Measured Linux qualification: a cold known-total query returned 30 in 1866 ms,
with a cgroup peak of 1160409088 bytes. The previous 768 MiB budget killed even
this valid calculation. With the measured 1536 MiB ceiling, 18 isolated runtime
cases pass, including joins, scalar parameters, precision, input/output bounds,
actual timeout/cancellation and concurrent admission. A computed 1 GB value hit
the cgroup ceiling and incremented `oom_kill`; the application process survived
and the next calculation returned 30. These are local synthetic measurements,
not service latency/cost objectives or fleet-capacity qualification.

Manifests record actor/workspace, publication, effective arguments, exact SQL,
input/SQL/source hashes, time, engine and limits. Eve owns the durable tool result;
compact chat artifacts reveal rows and provenance on demand. Freshness states
that the CSV is published and live provider freshness is unknown. Per-cell
lineage, clickable historical source excerpts, governed live connectors,
charts/files/dashboards and recurrence remain separate acceptance gaps.

On the parameterized-loader artifact, 24 runtime gates pass: 18 executor cases,
four native publication/revocation cases and two compiled Eve cancellation and
restart/replay cases (86.29 seconds). The complete check passes all nine tasks,
301 files / 1924 tests in 73.363 seconds; the build passes in 28.165 seconds.
A smoke test against capsules repackaged from that final build also passes;
finite configurations above the approved ceiling or with swap are refused.

Chrome 154 passes 26 checks using real shared components and the actual compiled
Eve result: 1440 × 900 and 390 × 844 in light/dark, plus 360 × 800 dark. The
initial transcript reaches its actual DOM bottom, rather than VirtualizedList's
estimated offset; the compact artifact opens the result and provenance, and
Escape restores focus. The browser adapters are an isolated harness, so this
qualifies rendering of the verified runtime output, not a full authenticated
multi-account app journey or native Electron/iOS/Android. The separately owned
room/reaction visual work is unfinished. Versioned numeric evidence and source
hashes are in [the K2 report](evidence/semantic-query-2026-09-30.json). These
checks qualify this bounded computation slice, not complete product parity.

## K3 private owner and future sharing boundaries

Private learned files require a repository authority keyed by authenticated
`(workspaceId, userId)`, excluded from every shared Git bundle/history/export and
router. `PrivateMemoryRepository` now implements this separate scope with actual
Git publication and transactional PostgreSQL heads/receipt indexes. Its isolated
journeys are verified; the live learned-memory tools/UI still use Akita until the
complete consumer cutover. Publication binds current authorization, verified
source excerpts, CAS and an operation receipt atomically. Reconstruct claim envelopes,
corrections/tombstones and receipts from authoritative files plus Git metadata;
SQL may index heads/grants/receipts but cannot own the only memory history.

The publisher chooses UTC microsecond order and actual Git revision. File payloads
must not contain their own hash. The next integration contract is a two-step
publication inside one authorized database transaction:

1. Capture the private head and current membership under its scope lock. Choose
   trusted author and UTC microsecond time strictly after the previous publication.
   Pure transition planning validates the change and returns its file, operation
   identifier and request hash; it must not require the future publication SHA.
2. Commit that canonical file with authoritative operation metadata (scope,
   author, recorded time, operation identifier and request hash) to the private
   Git bundle. Bind the version envelope and receipt to the resulting actual SHA,
   then CAS-publish the bundle/head and receipt index together. A retry returns its
   old receipt without applying the old file over a later correction/tombstone.

The scope comes from the authenticated principal, never a caller-selected owner.
Shared/group/delegated executions remain denied before repository lookup. Verify
file evidence against authorized recorded source revisions and verify session
evidence against that owner's immutable source journal; formatting a citation
never proves access or truth. Historical reversal must identify an actual ancestor.
A projection/receipt rebuild uses only that private bundle and operation metadata,
then rechecks current membership/source permissions before release. This contract
requires coordination of the five existing pure worker files before wiring; no
placeholder SHA, duplicate transition builder or live dual writer is acceptable. Rebuild
projections for the exact private scope/revision and revalidate source permission
before output. The small claim snapshot limits are fail-closed processing limits,
not a session-retention policy. Cut over session capture, memory tools, dreams,
export/restore and creator corpus consumers together before removing Akita.

Future sharing follows the user-approved hybrid intent model: trusted user intent
specifies exact data, audience and purpose; an independent Sentinel reviews the
proposal. Deterministic current ACL/membership, deny/revocation and a broker bind
a grant to the actual payload and destination. Uncertainty requires explicit
user selection. Group agents receive no blanket access to private files. This
criterion does not replace deterministic authorization or authorize an external
Boat setup, provider credentials or deployment.

The local loading comparison used five fresh capsule calls on each side, six
sources of 2000 synthetic rows each, identical known total 2001000, SQL and input
hash. Median latency was 3603.9 ms with individual inserts and 2545.1 ms with
200-row parameterized chunks; the sample p95 was 5478.5 versus 2574.9 ms. Small
samples and shared-machine load limit this result; it is not a production SLO,
per-response cost claim or broad engine comparison. The separate synthetic Git
benchmark favors one reconstruction over three; batching Git framing added no
benefit, so current native readers were retained.

### Private publication and source qualification — 2026-09-30

The additive `0098_private-memory` migration was applied only to the guarded
`companion_runtime_test` database and rerun idempotently. No database reset or
applied migration rewrite occurred. Six real publisher journeys establish private
isolation inside one company workspace, concurrent CAS, atomic rollback on receipt
failure, lost-index reconstruction, tombstone/replay safety, and current source or
membership revocation. Five source-journal journeys establish actual SHA256-bound
user/accepted-assistant evidence, cross-principal denial, receipt reconstruction
without changing a claim's actual commit/time, and no bypass of pending delivery.
A private Git regression rejects a valid operation message that conceals a change
to another claim. See [private-memory evidence](evidence/private-memory-2026-09-30.json).

Session evidence uses the actual immutable event digest, `sessionId`, `eventId`
and excerpt; there is no invented Git revision for a JSONL source. Unverified
assistant stream completions cannot support a claim. A settled assistant answer
remains evidence rather than verified truth, and its absent source timestamp stays
absent. Receipt rebuild changes only missing derived indexes under current owner
membership; it does not recreate permissions or acknowledge pending deliveries.

Remaining K3 gates: the atomic live tools/UI/recall cutover, complete bounded
backup/restore with retained tombstones and source journals, session/creator corpus
consumer cutover, erasure integration and capacity qualification. No Akita removal,
full parity, production throughput or enforced account quota is claimed by these
foundation tests. Current quota functions have no production admission/settlement
callers; durable native operation identity and once-only atomic settlement, payer
scope and reconciliation remain explicit work.

External-agent identity follows one stable directory UUID mapped to `agent:<uuid>`
and the existing Matrix identity/room membership/reconciler. It must not create a
second room transport or membership authority. Independent subject-bound grants
may coexist; rotating a selected grant never rebinds old tasks. The sponsor is an
audit fact, not the service principal's OAuth or private-memory authority. Identity
registration inhibits Matrix login and is not external runtime connectivity. The
integration owner retains grant/resolver/migration/offboarding changes; new member
schema/service and roster projections require coordinated ownership before edits.
