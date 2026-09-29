# Memory, creator bots and marketplace parity

Audit date: 2026-09-28. Baseline: `f17b039`. This is an implementation plan, not a claim of deployed parity. It complements [file-memory](file-memory.md) and the [social handoff](tryzoen-social-matrix-handoff.md). Those documents retain detailed evidence and historical checkpoints; later checkpoints supersede earlier limitations.

## Product contract

Create and improve a bot in the normal conversation. Interview the creator, import authorized material, explain gaps, build attributed knowledge, test and correct it together, approve a concrete version, then publish. The marketplace and ordinary people/group/bot conversations are the primary interfaces. Files remain inspectable through the shared visual editor. Do not create a parallel form-first creator product or restore the discarded standalone “Help me respond” flow.

Maintain four independent authorities: private creator drafts/interview; immutable published bot knowledge; each participant's private conversations/memory; explicitly authorized room knowledge. A subscription grants use of a release, never another person's data. Imported content cannot grant permissions. AI identities remain disclosed.

## Verified baseline and gaps

“Implemented” below means source plus existing recorded synthetic evidence, not production qualification. This audit inspected the tool/service contracts; it did not rerun the entire test suite.

| Capability                                                   | Status                                                                                           | Existing owner and remaining acceptance                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Real Akita executable, Markdown/Git authority, derived index | Implemented locally; deployment unverified                                                       | `server/memory/ai-memory/engine.ts`, `notes.ts`, `learned.ts`; Docker assets have checksums. Qualify retained-volume deployment, crash recovery and operational ownership before cutover.                                                                                                                                                  |
| Save, recall, correct, delete learned notes                  | Implemented with bounds                                                                          | `server/memory/learned.ts`, `ai-memory/mutations.ts`, `db/services/memory-corpora.ts`. Preserve idempotent receipts and source authority; qualify quotas, fair scheduling and selective historical erasure.                                                                                                                                |
| Typed relations and historical recall                        | Implemented, bounded scope                                                                       | `ai-memory/source-edit.ts` and `protocol.ts`; private `causes`, `fixes`, `contradicts` and ingestion-time `as_of`. Full document history review/restore UX remains partial. Do not call it full world-time/transaction-time bitemporality.                                                                                                 |
| Sessions saved on disk                                       | Implemented opt-in                                                                               | `agent/hooks/session-sources.ts`, `agent/memory/session-sources.ts`, `server/memory/session-capture.ts`, `session-files.ts`, `session-export.ts`. Accepted replies are archived, but generic Eve assistant content is not supported by upstream ingestion. Attachment ingestion, complete account archive and retention remain incomplete. |
| Dreams                                                       | Qualified engine behavior; product disabled                                                      | `scripts/ai-memory-dream/acceptance.ts` reproduces overwrite of later edits and recreation after deletion in 2.4.1. Never enable against a live corpus until the candidate/apply contract below is safe.                                                                                                                                   |
| Private multiplayer isolation                                | Implemented personal boundary; shared publication missing                                        | `agent/lib/personal-memory-access.ts`, `server/workspaces/access.ts`, memory namespace authorization. Room and published bot stores must be explicitly separate; no automatic promotion of private history.                                                                                                                                |
| Creator interview and draft editing by chat                  | Partial                                                                                          | `agent/tools/creator-library.ts` already lists/begins/reads/saves drafts and claims usernames with ownership/revision checks. It is a real conversational foundation, not an end-to-end importer/publisher.                                                                                                                                |
| Examples, playbooks, previews and evaluations                | Implemented backend; chat journey partial                                                        | `server/creators/drafts.ts`, `previews.ts`, `evaluation.ts`, `reviews.ts`; `agent/tools/creator-preview.ts` still requires a request made in Creator studio. Route these operations through the conversation and retire superseded controls when callers are replaced.                                                                     |
| Approved private versions and pilots                         | Implemented backend                                                                              | `releases.ts`, `release-candidate.ts`, `pilots.ts`; immutable evidence and explicit participant reports. No public discovery, billing or real expert effectiveness proof.                                                                                                                                                                  |
| YouTube/content inventory and ingestion                      | Missing end-to-end                                                                               | Add under concrete `server/creators` and Eve tools/workflows, reusing provider integration after registry/license checks. A pasted URL is not an indexed source.                                                                                                                                                                           |
| Published bot Akita corpus and grounded conversation         | Private corpus, grounded evaluations and qualified pilots implemented; public publishing pending | Compile approved sources to a separate versioned corpus and qualify retrieval in the specialist. Never reuse the creator's personal corpus as the released bot.                                                                                                                                                                            |
| Public marketplace and entitlements                          | Missing                                                                                          | `packages/companion-ui/src/creators/discover.tsx` currently supports a private discovery surface. Public listings, publication/withdrawal, access enforcement, charging/refunds and creator payout operations remain separate work.                                                                                                        |

The local application Mem0 adapter has already been removed; do not plan to remove it a second time. Hosted cutover and old external-provider erasure obligations remain. Eve profile notes are a distinct surface requiring an explicit final ownership decision.

## Ordered slices and acceptance

### C1 — Finish conversational private authoring

Reuse existing schemas and creator services from Eve tools. The agent can create a preview request, execute it durably, show the actual result, capture a correction, maintain held-out cases and present a release candidate in chat. Human approval must bind the exact candidate and evidence; a model cannot invent approval. Keep existing stale-write, archived-draft, membership and cross-owner rejection behavior. Replace the studio-only wording and callers as each complete slice becomes operational; do not remove working operations prematurely.

Acceptance: a synthetic creator starts with “create my bot,” answers questions, saves attributed examples, runs a real isolated preview, corrects it, and approves the displayed version entirely through chat. Restart/retry cannot duplicate execution or change approved evidence. Another account cannot read any draft, preview or private interview. No operation claims publication.

Owners: `agent/tools/creator-library.ts`, `agent/tools/creator-preview.ts`, `server/creators/*`, `tests/runtime/eve-creator-preview.integration.ts`. Shared UI adapters/schema changes require coordination with the shell owner.

### C2 — Authorized source inventory and resumable acquisition

Start with creator-supplied text/files, then an authorized YouTube channel and other providers. Persist provider identity, canonical URL, publication and ingestion times, digest, rights/access record, extraction method and per-item status. Separate discovered, acquired, extracted, reviewed and indexed states. Pagination, cancellation, quota exhaustion, revoked authorization, retry and duplicate sources must be visible and idempotent. Video excerpts need timestamp provenance; visual demonstrations require an independently qualified extraction path.

Acceptance: resume a partially failed multi-page inventory after process death without recharging/reimporting completed items; inaccessible captions appear as inaccessible, not successful. Source withdrawal invalidates future compilation. Malicious source instructions cannot invoke tools or change grants. The official [YouTube captions download API](https://developers.google.com/youtube/v3/docs/captions/download) requires authorized access; a public URL alone does not provide that authority.

Dependencies: C1, selected provider setup, durable Eve workflow and bounded file transport. Keep acquisition independent of personal-memory mutation.

### C3 — Scoped bot corpus and grounded evaluations

Compile approved source excerpts and authored expertise into readable files with source links, segment/timestamp references, content versions and uncertainty. Use the existing real Akita adapter, not a parallel vector database by default. Retrieval must identify its bot/release scope, preserve source attribution and reject unrelated/private namespaces. Keep source acquisition dates separate from Akita ingestion history.

Acceptance: source corrections produce a new candidate; active approved versions stay immutable. Cite relevant evidence, abstain when unsupported, and test contradictions/withdrawn sources. Two subscribers receive the same approved knowledge but cannot retrieve one another's sessions. Deleting a draft cannot silently mutate a published release.

Dependencies: C2 and a reviewed release/corpus manifest boundary. Reuse `agent/subagents/creator-specialist`, creator execution provenance, and existing private release/evaluation services.

### C4 — Publication, discovery and controlled access

Publish only an approved immutable version. Listings show creator, username, AI identity, purpose, coverage, version and access terms. Search/filter, preview, start conversation and authorized group invite are concrete routes. Unpublish, revoke and replace versions explicitly. A participant chooses whether to share feedback; creators see submitted feedback, not subscriber chats.

Acceptance: listing visibility and entitlement checks apply on every execution and retry, including after withdrawal/revocation. Group membership and bot participation grants are separate. User can identify which version answered. Public moderation/report/appeal flows and abuse limits are in place before broad discovery.

Dependencies: C3; conversation lifecycle and identities from the communications lane. Billing may build against a fixed entitlement contract in parallel but cannot ship paid access before enforcement.

### C5 — Paid access and creator outcome loop

Select a supported payment integration through the registry. Implement provider idempotency, signed webhook validation, delayed/out-of-order/replayed event handling, subscription/access reconciliation, refund/chargeback behavior, usage/cost receipts and creator revenue accounting. Define commercial terms before selling. Test sandboxes first; do not charge accounts as verification.

Acceptance: retries never duplicate charges; revoked payment cannot keep creating paid executions; cancellation and refunds have visible outcomes. Run real consenting creator pilots with predeclared outcome measures and version-linked reports. Do not market synthetic preview success as expert quality.

### M1 — Operational memory and honest historical controls

Qualify retained-volume placement, per-tenant quotas, queue fairness, host/supervisor failure, backup snapshots and recovery into quarantine. Reconcile DB receipts, source JSONL, Markdown, Git and derived index. Historical browsing must label ingestion-time history and distinguish live deletion from Git/backup retention. Complete selective erasure and legacy provider obligations with auditable receipts. Production migration must preserve existing records.

Acceptance: lost/corrupt index and whole-volume recovery are tested separately; missing authoritative files fail closed. Restoring stale snapshots cannot resurrect erased namespaces. Bounded reads/backlogs remain fair under one noisy tenant. Measure latency, throughput and recovery objectives before claiming capacity.

Owners: `server/memory/*`, `db/services/memory-corpora.ts`, `scripts/ai-memory-lifecycle-acceptance.ts`, runtime memory suites and deployment configuration. Coordinate changes with C1/C2 through these existing owners.

### M2 — Safe opt-in dreaming

Prefer a qualified upstream compare-and-apply/report contract. Until available, run native consolidation only on an isolated snapshot, save a reviewable candidate and apply under current authorization and exact source-revision checks. Reject candidates after edit, deletion, membership loss or source change. Preserve provenance and a verified Git checkpoint; provide opt-in/provider controls, progress, failure, review/undo, bounded retries/cost and staged-copy erasure.

Acceptance: delayed responses cannot overwrite newer human edits or recreate removed pages; interruption during apply is recoverable; no cross-person/room/release source enters a private dream. Test real recall quality against a declared evaluation set before enabling automatic consolidation. Existing deterministic native tests are necessary but insufficient.

Dependencies: M1 snapshot/recovery foundation and exact candidate mutation contract. Do not enable the current native scheduler directly in production.

### G1 — Room-scoped participation and reflection

Apply HUMA's attention/strategy/action/reflection separation inside Eve. Begin with mentions, explicit actions or scoped ongoing responsibilities. Serialize/deduplicate sends, reevaluate intentions after new messages and treat silence as a valid action. Reflection may use only room-authorized context, with bounded windows and revocation checks.

Acceptance: concurrent humans/bots do not create reply loops, repeated deliveries or charges; interrupted plans never act on stale context; removing a bot stops new work and access. No deceptive human identity or artificial human imitation is required.

Dependencies: communications realtime/durable delivery and C3 for published specialists; safe shared-memory semantics before persistent room reflection. Existing mention support is not the complete HUMA policy.

## Implementation order and ownership

1. Work proceeds with one agent at the user's latest request. Creator work follows C1 then C2/C3; operational memory follows M1 then M2. Shared schemas, UI and callers change together.
2. Publication follows corpus authorization; paid access follows entitlement enforcement. G1 follows Matrix delivery semantics. Preview creation and result retrieval through chat are now implemented; the checkpoints below record their boundaries.
3. Operational delivery isolation is implemented in the M1 checkpoint below. Continue with measured throughput, scheduler fan-out and recovery before opt-in dreaming, public publication or a capacity claim.
4. Every slice records implemented/partial/unverified status, authorization tests, narrow runtime evidence, `pnpm check`, `pnpm build` and relevant cross-platform/browser evidence. Attach verified images/video to its PR with `gh --attach`. Do not rerun unrelated heavy suites concurrently against the same database.

## Research and version evidence

On 2026-09-28, GitHub's latest-release API returned [Akita v2.4.1](https://github.com/akitaonrails/ai-memory/releases/tag/v2.4.1), published 2026-09-25. Recheck before an upgrade; main is not a stable-release guarantee. The pinned [temporal contract](https://github.com/akitaonrails/ai-memory/blob/v2.4.1/docs/temporal.md) is ingestion-time only. Existing local dream and restore race evidence is documented in [file-memory](file-memory.md); no upstream marketing statement overrides those executable findings.

[HUMA](https://arxiv.org/abs/2511.17315) informs participation and interruption, not Akita temporal storage or proof of long-term safety. [Tutor CoPilot](https://arxiv.org/abs/2410.03017) informs consented expertise capture, explicit strategies, held-out evaluation, human correction and outcome pilots. The detailed paper readings and limitations are retained in the social handoff. Neither paper supplies a ready-to-ship marketplace, and tutoring results cannot establish effectiveness in unrelated domains.

## First execution checkpoint — conversational evaluation review

The first C1 increment adds `evaluation`, `preview`, `result` and `candidate` actions to the existing creator library tool. They reuse the existing schemas/services and ownership/revision checks. The preview workflow still executes the isolated specialist; it no longer instructs the user to create every request in Creator studio.

`agent/tools/creator-review.ts` accepts only a completed evaluation's UUID. Its native Eve workflow loads the stored answer and predeclared rubric, then asks the human for a verdict and feedback. Only those human answers reach the existing review writer. The pending snapshot retains its original review revision, so concurrent corrections cannot be overwritten. No release approval or publication mutation is exposed in this increment. Non-evaluation previews and private-pilot results are not silently certified as held-out evidence.

The private Eve channel already checks session ownership on session and input-callback routes. Creator reads and writes additionally resolve live authenticated workspace access and reject group/protocol execution. Native questions do not add a permission grant to another user. The model-facing schema rejects injected verdicts, notes, rubric, review revision and user/workspace identity; its focused unit test passes. The compiled Eve suite passes all nine cases against isolated PostgreSQL, including real specialist workflow execution with a synthetic provider, human review across process restart, concurrent-review rejection and multi-turn conversational evaluation/preview/candidate operations. This is runtime contract evidence, not a real creator pilot or browser/device review of the new questions. Existing studio controls remain until their complete replacement is available.

## Second execution checkpoint — optional guided starting interview

`creator-interview` offers a starting conversation for an already saved private draft, not a mandatory questionnaire or a complete specialist. It asks about audience/purpose, method/voice and limits/escalation, one question at a time. Every question permits skip/cancel. Eve persists the paused workflow so it can resume after process restart. Normal conversation and the existing draft tools remain available for adaptive follow-ups and richer examples.

The model supplies only the draft identity and its expected revision. Human answers become a proposed Markdown addition; the original playbook, title, description and examples are preserved. The person reviews the exact resulting playbook before saving. Cancellation or skipping all questions leaves the draft unchanged. Final save uses the existing owner and stale-write checks, so a later edit, archive or access revocation cannot be silently overwritten. This does not ingest videos, approve a release, publish knowledge, or write subscriber/group memory. The raw question exchange remains in the private Eve conversation; only the deliberately approved guidance enters the draft.

Scoped lint passes, and the model-input boundary/tool inventory suites pass six tests. Three compiled Eve tests pass against isolated PostgreSQL: restart with a skipped question and exact approved save; final cancellation without a write; concurrent-edit rejection. These use synthetic private drafts. Browser/device presentation and an adaptive real-creator interview remain separate verification gates.

## Third execution checkpoint — reviewed workspace source snapshots

`creator-sources` acquires a real `knowledge/*.md` file at an explicit workspace Git revision into a private, bounded source inventory. The snapshot retains exact original text, SHA256, path, revision, extraction method and acquisition timestamp. Acquisition alone does not add teaching or claim indexing. Each source starts acquired; chat-based human review displays its exact text and attribution and asks the person to declare original authorship, permission or public-domain rights. Cancellation leaves the source uncompiled.

Reviewed sources become attributed reference examples in the existing draft and genuine isolated-specialist preview pipeline. Applying a source validates the draft/source revisions and the aggregate 48 KB preview budget transactionally. Managed source examples cannot silently change their attribution or resurrect a withdrawn source through the generic draft editor. Withdrawal is also human-confirmed, removes the source from future draft previews and changes the draft revision when teaching changes; saved previews and approved releases remain immutable. A corrected file requires a new source snapshot and explicit retirement of its predecessor. This release is limited to 20 retained source snapshots per draft, 24,000 characters per source, and existing example limits.

This is the first C2 slice, not complete C2/C3: no YouTube crawling/caption acquisition, arbitrary local-path reading, direct audio/video extraction, public publishing or Akita indexing. The existing Akita engine is not reused through a private personal namespace. A separate release-scoped corpus manifest and retrieval owner remain required before C3. Source examples are untrusted evidence; the preview specialist still has no tools, personal memory or other participants' conversations. Workflow/runtime tests cover human review and restart, provenance reaching actual model context, withdrawal, stale revisions, cross-user denial and atomic size rejection; The source workflow suite now has four passing scenarios, including UUID collision isolation and exact leading/trailing whitespace in the actual preview snapshot. Across source, draft, preview and release suites,22 isolated runtime tests passed. The three affected PGlite suites passed24 tests after migration delimiter verification. Four tool inventory tests and scoped lint also passed. Browser/device interaction and full integration checks remain separate delivery gates.

### C3a implementation checkpoint — approved-release corpus

Release approval now freezes a typed immutable manifest in the same transaction as its approved revision. It preserves the exact reviewed source text, attribution, declared rights, source Git revision and SHA256, plus UTF-16 citation offsets. Each approved release gets a separate private `creator-knowledge` directory and native Akita index; `creator-knowledge` exposes build, status and bounded lexical search through chat. Active accepted pilots can search their explicitly shared release. They cannot build it or choose arbitrary storage namespaces. Old releases without a manifest require a new approval.

This uses the existing real Akita2.4.1 owner with embeddings and dreams disabled. It never indexes personal memories, participant conversations or search requests as teaching. Returned evidence includes exact excerpt/page digests and source provenance. Search checks the approved page inventory and reads back each returned page for exact content verification. Failed initial builds resume approved pages; missing accepted storage and foreign pages fail closed. Release/account deletion uses the existing durable filesystem erasure queue. Source withdrawal changes future draft versions; explicit published-version retraction remains a separate capability.

The specialist answer runner remains snapshot-based. These search results do not silently change its behavior or qualify retrieval-generated answers, and existing preview approvals must not be described as retrieval evaluations. C3 still needs source-grounded answer evaluations, contradiction/uncertainty handling and retrieval-qualified release gates. C2 still needs authorized external-content ingestion such as YouTube.

Validation:4 isolated integration scenarios use the actual Akita binary, covering tool build/search, exact bytes and release/account isolation, pending/active/withdrawn pilots, interrupted indexing, foreign pages, volume loss/symlink rejection and durable erasure. All4 and6 existing release tests passed. The database migration chain check passed. Full repository and browser gates remain integration-owner responsibilities.

### C3b implementation checkpoint — private grounded evaluations

A creator can now request `kind: grounded-answer` through the existing conversational preview owner, referencing an indexed approved release and a saved evaluation case. The preview freezes a bounded package of exact Akita excerpts, citations, offsets and digests before execution. The isolated specialist receives approved behavioral guidance, the question and those excerpts; full examples, evaluation criteria and parent history are excluded. Its only framework tool is the structured-result formatter. It has no operational tools, personal memory or connected apps.

The server checks native corpus availability and evidence integrity before execution and acceptance, validates the structured result and rejects invented citation identifiers. Supported results require actual references; an empty retrieval package can only produce an insufficient-evidence result. This verifies citation identity, not factual entailment: the human still reviews the actual answer and frozen excerpts through the existing native review questions, with revision checks and restart persistence.

Preview records expose their explicit execution mode. Existing immutable release evidence keeps its original document contract. Grounded evaluations cannot satisfy snapshot release approval, and pilots continue using snapshot answers. A new grounded-release approval and pilot-admission contract remains required; this feature does not change published specialist behavior or claim complete C3 qualification.

Validation:4 isolated grounded scenarios use actual Akita and a compiled Eve workflow with a deterministic provider fixture. They cover genuine structured child execution, absence of parent history and held-out criteria, human review after restart, frozen citations, cross-user denial, invented citations, no-match abstention and revoked-session denial. A genuine structured specialist result with an unknown citation ends in terminal failure without saving its prose or references. Together with existing preview/release regressions,19 runtime tests passed. The pure citation-offset test also passed. Provider answer quality and broad adversarial entailment remain separate evaluation work.

### C3c implementation checkpoint — explicit private grounded qualifications

An approved source release can now receive a separate immutable private grounded qualification. It references the existing release and exact corpus manifest, without copying content into another release or memory engine. Every current evaluation case must declare its expected grounded outcome before execution, and the set must include both supported and insufficient-evidence cases. Each latest actual grounded result must match that declaration and retain a useful human review, model identity and timing. Changed declarations, stale review references or mismatched corpus digests cannot qualify an earlier candidate. This gate establishes reviewed test coverage, not general answer quality or proof of expertise.

`creator-qualification` exposes candidate/list/read and a native human confirmation followed by approval notes. The frozen review references survive workflow restart; approval rechecks them under the existing draft/preview locks. `creator-pilot` asks the human before inviting, accepting, declining or withdrawing. A new invitation explicitly references the qualification. Existing invitations without that association remain snapshot mode; indexing or qualification never silently changes them. Both modes remain private and bounded. A participant in a grounded pilot receives only retrieved excerpts from the frozen approved source scope, behavioral guidance and their current question. Personal memory, prior chats and tools remain excluded. Active membership, pilot access and exact corpus evidence are rechecked before execution and completion; withdrawal blocks late output. The creator cannot inspect participant previews.

New agent-created preview, source, qualification and invitation IDs derive from the existing workspace-operation owner and native session/turn/tool/call identity. The model no longer supplies new UUIDs for these operations. UI and service idempotency contracts remain explicit. Qualification metadata lists do not load full evidence packages; detailed evidence is available only through its authorized record owner.

Owners: `server/creators/qualifications/records.ts` owns authorized immutable record reads; `qualifications/index.ts` owns candidate validation and approval; existing pilots, grounding and preview owners enforce execution. Migration0089 adds qualification records and the optional pilot association while preserving historical release payloads. Existing erasure cascades remove qualification records with their owning release; the actual corpus continues using the existing memory-erasure queue.

Validation so far:18 isolated runtime tests passed across grounded execution, existing creator previews and source acquisition, including actual Akita retrieval, native human approval after restart, participant invitation/acceptance, private grounded execution, unchanged snapshot mode and revocation before completion. The operation-ID test proves replay stability and separation across native turns/calls. The final five-scenario grounded rerun also passed with stale-review, changed-declaration and refuse-everything admission regressions. Five unit/tool-inventory checks passed. Full integration and browser verification remain parent delivery gates. Public marketplace distribution, paid entitlements, external YouTube ingestion and broad model-quality/entailment evaluations remain open; this is not full C2/C3 or production-scale qualification.

### C1/C3 chat completion — private base-release approval

`creator-release` now closes the remaining Studio-only approval step: candidate, read and list reuse the existing release owner; approve freezes the exact teaching and reviewed case references, shows them to the human, then asks confirmation and approval notes through native Eve questions. Cancelling either question writes no version. On resume, `approveCreatorRelease` rechecks live authorization, draft/evaluation revisions and human review references under its existing locks. No new database owner or migration is introduced. This approves a private snapshot-mode base version; real corpus indexing and grounded qualification remain explicit separate operations.

The compiled native workflow suite passed10 scenarios, including cancellation at both questions, changed review evidence during the approval wait, and successful human approval after process restart. The existing snapshot claim contract is preserved: only teaching, question and kind reach snapshot/playbook children. Grounded children additionally receive their frozen evidence, and pilot IDs stay internal to authorization. The four evaluation/pilot/preview/grounded service suites passed22 tests with these exact payload assertions. Type checking and tool-inventory checks passed. Authored tool behavior follows the installed Eve `tools/workflows.mdx` and `tools/human-in-the-loop.md` contracts for durable steps and native human questions.

### C2 uploaded sources and evaluation preservation — wave 8

The chat can now arm a short-lived upload request for one new UTF-8 Markdown or
text attachment. `creator-uploads` consumes the actual next human file event;
model-provided bytes, URLs and older attachments cannot satisfy it. The request is
bound to the live owner, workspace, authentication session, Eve session and draft
revision, expires after 15 minutes and caps one file at 96 KB / 24,000 characters.
It preserves original bytes and provenance. Acquisition remains distinct from
native human rights/content review and adding the source to the draft. Status and
cancellation are explicit. Migration 0090 stores intake metadata; neither source
text nor credentials enter that queue table.

Status exposes the source revision and current draft revision separately. A stale
review request returns a conflict before asking the human, allowing the agent to
reload the correct revisions. Approval still validates revisions transactionally;
it cannot overwrite an edit that occurs while the question is pending. Compiled
runtime tests cover restart, expiry, cancellation, exact bytes, revocation, replay
and review conflicts. Browser QA imported a synthetic local file, displayed the
rights question and confirmed the attributed teaching only after approval.

Saving an evaluation through chat now merges cases by identity. Adding an
insufficient-evidence case preserves the previously declared supported case.
Removal is a distinct human-confirmed operation that rechecks the saved revision.
Runtime tests and a real synthetic conversation verify the two cases coexist;
this is coverage evidence, not a claim of creator expertise or answer quality.

Two memory runtime defects found during that walkthrough are covered separately.
Missing/empty continuation turn IDs no longer collapse different Akita native
sessions into one already-ended session. The real native regression preserves
independent receipts, and the local pending queue drained through its ordinary
schedule. Eve's memory callback closure now handles SDK media in both history and
turn input; ordinary attachments previously removed all enabled memory tools.
The compiled regression covers URL, binary subarray and ArrayBuffer attachments,
native approval, process restart, exact staged bytes and the subsequent tool
catalog. The narrow dependency correction and its removal gate are documented in
`patches/README.md`.

YouTube/external extraction, public marketplace, paid access, dreaming and scale
qualification remain open. The next M1 slice isolates tenant ingestion failures
and bounds work fairly before any capacity claim.

### M1 delivery checkpoint — 2026-09-28

The [fair delivery contract](file-memory.md#fair-session-delivery-and-durable-retry--2026-09-28)
replaces the all-account transaction with separately committed, bounded batches.
Failure persists per-account retry timing without blocking healthy accounts;
capture cannot bypass the failed head. Concurrent workers skip owned namespaces,
and organization revocation is checked even when workspace membership remains.
Migration 0091 is additive. Native engine ingestion and immutable-file replay
remain the same implementation.

A reproducible `scripts/session-archive-capacity.ts` harness measures real native
ingestion with synthetic accounts and JSON output, fenced to the isolated runtime
database and temporary files. It excludes the minute cadence; results must not be
extrapolated to a million accounts. Next M1 gates are measured dispatcher capacity,
scheduler fan-out, large/inactive-backlog query plans and retained-volume recovery.
