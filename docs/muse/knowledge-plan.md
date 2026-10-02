# Knowledge and ontology — implementation contract

This document defines the product and correctness requirements for Zoen's
knowledge system. The [current architecture](../eve/architecture.md) maps the
runtime owners. Private Git claims and immutable session journals are active;
production capacity and complete platform qualification remain separate
acceptance gates.

## Decisions

- Use one file-backed architecture for authored ontology, learned claims and
  retained sessions, with separate authorities for separate visibility scopes.
  Update complete slices and their callers together; retain no Akita runtime,
  parallel authoritative memory copy or compatibility path.
- TextQL is the product and workflow reference. A semantic compiler executes
  published definitions; it does not become another knowledge authority.
- Eve owns execution and approvals, PostgreSQL owns identities, grants and
  product records, Matrix owns communication, and Kernel owns browser execution.
  Opening chat or reading a document must not start an analytics engine or VM.
- Ontology definitions are authored files at a published Git revision. Stable
  object IDs survive labels and paths. Search and graph projections name their
  source revision and cannot grant access.
- Use a maintained semantic compiler in its native format. Do not build a TQL
  interpreter or universal semantic language. Temporal claims and analytic
  metrics have distinct responsibilities.
- World-valid time requires explicit source evidence. Ingestion time and Git
  publication time cannot stand in for it; missing dates remain unknown.
- Sharing requires explicit publication and grants. A private conversation,
  hidden Git history or credentials cannot accompany a shared document.

## TextQL reference and Zoen acceptance contract

The [TextQL ontology product](https://textql.com/products/ontology), public
[skills](https://github.com/TextQLLabs/skills/tree/31123f39645d3b7872319ee8b304dae0f0f0a12f/ontology/skills-pack)
and [starter kits](https://github.com/TextQLLabs/ontology-starter-kits/tree/72c9a5df9da1e52f094a7faf80d3eb5aebbc653e)
are research references for conversational discovery, scoped definitions,
versioned files and reviewed changes. They are not installed capabilities or
permission to copy vendor code; reuse requires an applicable license.

For Zoen this means:

- **One file-backed knowledge system.** Distinct visibility scopes require
  distinct repositories. Private `(workspace, user)` claims and sessions must
  never enter a shared bundle, export, history or router. Sessions, definitions,
  relationships, evidence, procedures and generated artifacts follow the same
  publication and access rules. Live data stays at its source unless an
  authorized import explicitly snapshots it.
- **Conversation drives authoring.** Start from connected evidence and the
  user's intended decisions. Propose a short purpose document and useful
  questions; ask only for unresolved meaning. Users need not learn a modeling
  language or fill in schema forms.
- **Read, discover, answer, propose.** Load authorized published definitions
  first. Explore the missing part, cite evidence and propose reusable knowledge.
  Answering a question does not silently approve a new definition.
- **Scoped routing.** Small indexes point to canonical records loaded on demand.
  Links, search snippets and historical views cannot reveal private names or
  paths. Conflicting team definitions need an explicit attributed relationship.
- **Reviewed publication.** A proposal includes related files, evidence and
  dependencies at one base revision. Review, accept or reject the complete diff.
  Concurrent edits and access revocation prevent stale publication. Agent prose
  cannot grant permissions.
- **Reuse beyond answers.** Reports, routines, skills and apps refer to published
  definitions by stable ID and revision. Known-result checks qualify computation;
  answers identify source revision and freshness. Git remote synchronization and
  external editing remain planned; bundle export does not implement them.

## Current owners

| Capability                                             | Owner                                                                                      |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| Published files and atomic Git bundles                 | `server/workspaces/repository.ts` and `server/workspaces/git.ts`                           |
| Ontology validation and shared Library contracts       | `server/workspaces/ontology.ts` and `packages/companion-ui/src/library/ontology/schema.ts` |
| Private claims, history and retrieval                  | `server/memory/repository.ts`, `claims.ts` and `retrieval.ts`                              |
| Immutable session capture and recovery                 | `server/memory/session-capture.ts`, `session-files.ts` and `session-export.ts`             |
| Bounded computation over published CSV snapshots       | `server/workspaces/semantic`                                                               |
| PostgreSQL connection registry and credential boundary | `server/connectors/connections.ts`                                                         |
| Workspace authorization, invitations and membership    | `server/workspaces/access.ts` and `server/workspaces/team.ts`                              |

Git bundles are published with their PostgreSQL head and operation receipt in
one transaction. Current access, expected revision and idempotent operation
identity are checked again at publication. A retained filesystem or derived
SQLite projection must preserve those guarantees; two unrelated filesystem and
SQL writes would regress recovery and concurrency safety.

## Published knowledge and history

Model files retain their native source text. Stored text alone does not qualify
its syntax, imports, credentials or execution. A published computation must bind
its model and declared sources to one immutable reconstruction and expose typed
arguments, bounded results, cancellation and a deadline. Clients receive no
arbitrary connector credentials or unrestricted SQL access.

Ontology properties and relationships carry explicit evidence and known-time
history. World-valid intervals remain separate. A correction cannot inherit the
previous value's evidence or invent a source date. Stable IDs keep historical
records addressable after rename or move.

Historical reads select an exact revision or a timezone-qualified recorded time,
never both. Historical content remains subject to current authorization. Evidence
views distinguish a passage found at its recorded revision from a source that is
still current; a stale, removed or inaccessible source must remain visible as
such without disclosing its private content.

Conversation, Library dossiers, reports and routines use these shared contracts
across web, desktop and mobile. Multi-file publication includes its dependent
model, definition and routing records atomically. Files remain readable without
starting computation.

## Private memory and session authority

Private learned files are keyed by authenticated `(workspaceId, userId)` and
excluded from shared Git bundles, history, exports and routing. The scope comes
from the authenticated principal, never a caller-selected owner. Shared, group
and delegated executions are denied before private repository lookup.

Publication binds current authorization, verified source excerpts, compare-and-swap
revision checks and an operation receipt. The publisher chooses the author and
UTC microsecond ordering, commits canonical files with operation metadata, then
binds the receipt to the actual Git revision. File payloads cannot contain their
own future hash. A retry returns its original receipt without applying an older
file over a correction or tombstone.

Claim envelopes, corrections, tombstones and publication receipts must be
reconstructable from authoritative files and Git metadata. SQL indexes cannot
own the only memory history. Rebuilt projections name their exact private scope
and revision and recheck current membership and source permissions before output.

Session journals retain original event identity, author, source, ordering and
receipt links under the conversation's access boundary. File citations require
permission to the recorded source; session citations require the owner's exact
immutable event bytes. Formatting a citation does not establish permission or
truth. Unverified assistant streams cannot become claim evidence; accepted
assistant output remains evidence rather than verified truth.

Large attachments need bounded blob references and lifecycle rules. Processing
bounds on claims and source files are refusal limits, not a conversation-retention
policy. Retrieval, relations, historical reads, ingestion idempotency, correction,
erasure, export/restore and interruption recovery must use this same authority.

## Recovery and erasure requirements

A private backup authenticates the Git bundle and canonical bytes of every cited
session event in its retained lineage, including later-corrected claims. Its
envelope binds the namespace, private scope, Git revision, session/event identity,
capture sequence and byte hashes with the installation key.

Restore validates current app/session ownership, retained erasure obligations,
Git ancestry and expected revision, historical and current source permissions,
exact citation coverage, existing files and delivery receipts before writing.
Pending delivery, conflicting immutable bytes, sequence collision, missing native
allocator high-water or a sequence beyond that high-water must block recovery.
Capture and repair share the namespace and allocation fences so recovery cannot
miss an uncommitted allocation.

Only a complete preflight may write missing immutable files and reconstruct
missing delivered-receipt indexes. Files are synced before indexes acknowledge
them. Pending receipts are never promoted to delivered. Replay repairs missing
indexes without overwriting bytes or changing source dates and Git history;
receipt-rebuild time remains operational metadata. Archive sizes and metadata
are bounded before allocation.

An exact namespace's pending erasure blocks reads, recall, changes, history and
index rebuild. The erasure worker verifies the retained receipt's owner under the
namespace lock; contention or uncertain ownership retains the obligation without
filesystem effects. It retires only that namespace generation. A new generation
for the same workspace/user is not a deletion target, and an archive from the
retired generation cannot restore into it.

A private archive cannot reconstruct session authority or prove erasure after a
database rewind that loses the deletion journal. Coordinated installation recovery
must preserve ownership, allocator state and the non-restored erasure journal.
Concurrency, restore contention, provider erasure and capacity need their own
runtime qualification.

## Learning and future sharing

Consolidation reads a fixed source revision and writes an isolated, reviewable
candidate. Apply and undo retain receipts and recheck edits, erasure and access.
Dreams cannot rewrite authored rules or published definitions silently.

Future sharing follows the hybrid intent model: trusted user intent specifies
exact data, audience and purpose; an independent Sentinel reviews the proposal.
Current ACLs, membership, revocation and a broker bind the grant to the actual
payload and destination. Uncertainty requires explicit user selection. Group
agents receive no blanket access to private files.

External agents retain a stable directory UUID mapped to `agent:<uuid>` and the
existing Matrix identity and membership authority. Independent grants may coexist;
rotating one grant never rebinds old tasks. Sponsorship is an audit fact, not OAuth
or private-memory authority, and identity registration alone does not establish
external runtime connectivity.

## PostgreSQL registry boundary

The connector registry stores PostgreSQL configuration separately from HTTP
endpoints and operations, with database constraints preserving that separation.
Registration requires a current authenticated app session and management access.
Personal and organization workspaces use the same contract; private-channel,
group, external-agent and scheduled contexts receive no PostgreSQL registry entry.

Credentials use one encrypted envelope bound to workspace, connection, revision
and connector kind. Secrets are absent from metadata, ontology files and remote
discovery. PostgreSQL is rejected before remote credential release and cannot
become an HTTP operation. The setup form remains HTTP-only, and PostgreSQL
metadata reports live reads unavailable.

Published CSV analytics is the active computation path. Live warehouse reads
still require a trusted actor/payer, durable once-only admission and settlement,
validated parameters before credential access or network I/O, bounded TLS and
cancellation, and post-read authorization and provenance. Plan values and Stripe
entitlements do not implement those execution gates; see the
[quota requirements](../decisions/adr-quotas-admission-r1.md).

## Acceptance gates

1. **Engine and computation:** known-result fixtures for totals, one-to-many joins,
   empty inputs, concurrent readers, parameters, denial and revocation; documented
   engine limits and bounded execution. See [semantic engine review](semantic-engine-review.md).
2. **Publication:** native models, scoped routing and purpose documents, related
   proposals, stable identity, exact revisions, source evidence and atomic review.
3. **Memory:** complete session and claim files, rebuildable projections, bounded
   history, attributed valid/known time, snapshot/restore and retained tombstones.
4. **Learning:** isolated candidates, review/apply/undo, receipts and interruption,
   edit and erasure safety.
5. **Collaboration:** authorized Library dossiers, evidence and scoped proposals;
   browser takeover and on-demand Linux remain explicit platform adapters.
6. **Analytics breadth:** exploration can propose reusable definitions; approved
   definitions feed reports, apps and Eve routines. Qualify each connector's
   revocation, cancellation and failure behavior separately.
7. **Operations:** durable budgets, source freshness, cache revocation, backup
   recovery, workload measurements and platform qualification. Capacity claims
   require measured workloads, not a schema or compiler test.

Development and test data are disposable under the repository's greenfield
policy. Remove obsolete interfaces directly and keep the migration/setup chain
coherent. Rewriting an applied migration requires resetting the affected databases;
baseline consolidation remains a coordinated change. Creator marketplace expansion
remains outside this contract.
