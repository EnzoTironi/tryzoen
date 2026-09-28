# Social/Matrix implementation handoff

Updated 2026-09-28 from the user-provided `tryzoen-social-matrix-handoff.md` and the HUMA and Tutor CoPilot PDFs. This reconciles that handoff with the running code; it does not replace Muse parity work or claim a completed social client.

## Direction and proposals

The user wants personal agents, official specialist/creator agents, real people and communities, with iMessage-inspired conversations and a desktop sidebar. Matrix is the chosen communication feasibility candidate. Eve remains the execution owner; Zoen owns accounts, grants, subscriptions, goals and published content.

The proposed `Conversas / Descobrir / Meu espaço` navigation and photography pilot are not final commitments. Preserve existing Muse capabilities. Mark official AI identities clearly; a creator and their AI are different senders. Paid AI access does not imply unlimited personal access to the creator.

## Existing implementation to reuse

| Owner                                                    | Existing seam                                                                    | Not established by this seam                   |
| -------------------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------- |
| `server/matrix/client.ts`                                | Authenticated server requests                                                    | Mobile client or encrypted local event storage |
| `server/matrix/inbound.ts`                               | Homeserver auth, transaction/event deduplication and live room membership checks | Device E2EE/key recovery or push delivery      |
| `server/matrix/conversations.ts`                         | Agent conversation ownership and routing                                         | Human community UI or entitlement policy       |
| `agent/channels/matrix.ts`                               | Native Eve channel and durable execution                                         | Offline iOS/Android synchronization            |
| `scripts/agent-evals/network.ts`                         | Two synthetic accounts, public/private separation and real Matrix/Eve fixture    | Million-user capacity                          |
| `docs/decisions/evidence/network-matrix-2026-09-15.json` | Recorded backend evidence                                                        | Fresh mobile/encryption qualification          |

## Required feasibility slice

Use two synthetic people and an explicitly identified community agent. Exchange messages between web and real Expo development builds on iOS/Android. Restart/disconnect/reconnect and prove ordering, retry deduplication, device-key persistence, recovery, encrypted history policy, push-to-room navigation and agent grant/revocation. Browser WASM/IndexedDB SDK support is not proof of React Native support; qualify a maintained Rust SDK bridge before selecting it. Record compatible versions and licenses.

Backend entitlement checks govern access. Revocation removes future access under a documented history policy; it cannot retract plaintext already delivered. A room admitting an agent explains authorized model processing. Personal memory, expert-published knowledge and community context have distinct boundaries; see [Akita adoption](file-memory.md).

## HUMA: useful behaviors and evidence limits

Reference: Jacniacki and Carmona Serrat, _Humanlike Multi-user Agent (HUMA): Designing a Deceptively Human AI Facilitator for Group Chats_, [arXiv 2511.17315v1](https://arxiv.org/abs/2511.17315). The supplied nine-page PDF was read and the architecture figure visually inspected.

The useful separation is attention/strategy routing, action execution and bounded reflection. New events can interrupt a pending response; silence is valid. The paper serializes message sends and retains pending intentions across interruptions. Apply these ideas within Eve and durable Matrix delivery, without adding another runtime.

Zoen participation starts with mentions, explicit actions or a scoped ongoing responsibility. Each event needs a durable receipt; concurrent replies must not cause loops, duplicate messages or repeated charges. Reevaluate pending actions after newer messages. Keep reflection room-scoped; never promote chat text into permission or private memory automatically. Full-history context is not a bounded production implementation. Deceptive identity and artificial human typing delays are not requirements: our agents stay visibly identified as AI.

The study involved 97 participants in short roleplayed generative-art chats (41 human facilitator, 56 AI). It does not establish long-term trust, retention, moderation safety or autonomous expert accuracy. Human means were higher on three of four reported experience scales; near-chance identity detection is not equivalence evidence. HUMA informs participation, not the temporal memory architecture; Akita is the selected memory reference.

## Delivery sequence

1. Preserve Muse flows and the shared Markdown editor.
2. Qualify Matrix platform transport, encryption and recovery with the fixture above.
3. Implement explicit specialist publishing and scoped knowledge, never a copy of the creator's entire personal memory.
4. Add scoped community participation, observable interruptions, deduplicated delivery and bounded context.
5. Enforce entitlement/revocation before paid access. Pricing and final navigation remain product decisions.
6. Measure useful outcomes, second-specialist discovery, retention, recall accuracy and cost. Message/account counts alone are not success or capacity proof.

No new Expo Matrix transport, device encryption proof, creator billing or HUMA router was introduced merely by adding this handoff. The private authoring implementation below is a separate verified step toward creator publishing.

## Creator workflow from Tutor CoPilot

The user explicitly added a creator/bot marketplace and selected _Tutor CoPilot: A Human-AI Approach for Scaling Real-Time Expertise_ (Wang et al., [arXiv 2410.03017v2](https://arxiv.org/abs/2410.03017), supplied PDF dated January 26, 2025). Section 3, Figure 1 and Appendix A inform the implementation process. This extends the required product scope; marketplace listing, creator billing and measured expert quality are not already implemented.

Tutor CoPilot uses Bridge to turn experts' voluntarily verbalized decision-making examples into instructions. During a tutoring session it takes the topic, selected strategy and recent conversation; names are replaced with roster-derived placeholders and external context is capped at ten messages. Tutors can edit, regenerate or select another strategy. The human chooses how to use the guidance. This differs from automatically posting a creator impersonation into a community.

Apply that process to Zoen as a versioned publishing workflow:

1. **Capture expertise with consent.** A creator supplies representative cases, observations, chosen strategies, rejected alternatives, limits and examples of a useful response. Keep source attribution and rights with each case. This is authored expertise, not extraction of private model reasoning or copying the creator's personal sessions.
2. **Draft an explicit playbook.** Produce readable Markdown strategies, triggers, context requirements and failure/escalation conditions using the shared editor. Show provenance. The creator reviews the transformation; a draft never silently becomes published behavior.
3. **Evaluate a release.** Run separate held-out cases and a rubric approved by the creator, including inappropriate-context cases, cross-account/room isolation, unsupported claims and withdrawal. Record usefulness, latency and cost. Pilot before a broad release, inspect failures and revise. The paper's pilots with 10–20 tutors identified delays above 30 seconds and improved retrieval before the larger study; those numbers are evidence, not universal product targets.
4. **Publish selected knowledge only.** An immutable released playbook and explicitly selected sources constitute the expert corpus. Listing identity, permissions, version, access terms and AI disclosure accompany the bot. An entitlement is permission to use that release, not permission to read the creator's private memory or other subscribers' sessions.
5. **Offer contextual assistance.** Use bounded authorized room/conversation context with approved published strategies; expose edit/regenerate/strategy selection. In human-assist mode, suggestions remain drafts until the person sends them. Autonomous community participation additionally follows the HUMA attention policy and its explicit room grant.
6. **Keep learning boundaries separate.** Private session archives and dreams belong to the individual owner. Community memory belongs to its room. Published expert revisions require creator review. No cross-user dream, automatic publication of subscriber data, or promotion of conversation text into connector/room permissions.
7. **Measure outcomes after release.** Compare useful task outcomes and subgroup failures, record feedback tied to the released version, allow withdrawal and make cost/usage understandable. Engagement volume alone is not proof of expert quality.

The trial involved about 900 tutors and 1,800 K–12 students and reported a 4 percentage-point mastery improvement overall and 9 points for students of lower-rated tutors; these findings do not validate unrelated domains or Zoen's marketplace. Grade-inappropriate suggestions remained a reported problem. Reuse research code only after checking the official [Tutor CoPilot repository](https://github.com/rosewang2008/tutor-copilot) and Bridge implementation, maintenance, license and privacy behavior. The paper supplies a process and evaluation reference, not a ready-to-deploy marketplace backend.

## Private creator authoring — 2026-09-28

Creator studio now opens from companion General settings on web/Electron and the
native settings screen. The shared React Native screens create a specialist
draft, edit its name/description, edit its Markdown playbook, and add, revise or
remove authored examples. Playbooks and example bodies use the same visual
document editor as the rest of the product. Desktop uses centered modals; mobile
uses sheets, with the full document editor for Markdown.

The example template asks for the situation, observations, chosen strategy,
alternatives, useful response and limits. Each saved example has an explicit
source and an original/permission/public-domain declaration. The interface asks
the creator to confirm that declaration for each save; this is an attestation,
not automated verification of a license. No model reasoning or private sessions
are extracted. Authoring is manual at this checkpoint; model-assisted synthesis
and separate held-out evaluation remain unimplemented.

Migration 0069 stores drafts under the current person and workspace, with a
membership foreign key and deletion cascade. Only a live authenticated human
session can access them; workspace peers and agent grants cannot read them.
They are separate from generic workspace files, private learned memory, room
context and the existing workspace-bot grant protocol. Creating a draft neither
publishes it nor connects its instructions to an active agent.

The initial bound is 20 drafts per person/workspace and 20 examples per draft.
Each playbook is at most 64,000 characters and each example at most 24,000.
Lists return summaries without large bodies. An owner-scoped advisory lock
serializes quota checks before membership share locks. Revision checks reject
stale overwrites; exact current-content retries preserve their revision after a
lost response. Editor snapshots retain their opening revision and preserve
failed or unsaved text. Four isolated PostgreSQL cases cover actor/workspace
isolation, forged authority, deletion cascade, concurrent revisions, 25 parallel
creates against the 20-draft limit and source/rights/input bounds.

Still required after the authoring checkpoint: model-assisted playbook synthesis, version-bound held-out evaluation, immutable
selected-source publishing, discovery, entitlements, withdrawal, bot execution,
human-assist feedback and outcome measurement. This is a private authoring slice,
not a working public or paid marketplace.

Verification for this authoring checkpoint: `pnpm check` passed all 1,323 tests
across 205 files; `pnpm build`, `pnpm db:check` and Expo exports for web, iOS and
Android passed. Four creator cases passed against the isolated PostgreSQL
runtime database. In Chrome, a clearly fictional specialist was created, its
visual playbook and attributed example were saved and reopened, its description
was edited, and the example-removal confirmation was cancelled. Desktop modal
and 390×844 mobile sheet evidence is attached to
[PR 148](https://github.com/EnzoTironi/tryzoen/pull/148#issuecomment-5865419575).
These exports are compile checks, not physical-device qualification. The
structural quality report still flags RPC-wrapper similarity and component size;
it is not a clean structural gate and no finding was suppressed.

## Creator archive and export — 2026-09-28

Migration 0070 adds reversible archival. The studio separates active and archived
drafts, keeps archived playbooks/examples readable in the shared visual editor,
and restores editing only after a revision-checked restore. Archived drafts
cannot be changed by a stale editor. Archive/restore response-loss retries are
no-ops only when the requested state already holds; an old archive request cannot
archive a subsequently restored draft. Owner serialization enforces 20 active
and 100 total retained drafts. Lists contain at most 100 summaries, never bodies.
These are explicit initial storage limits; archival is not deletion.

Export reauthorizes and fetches the selected draft before preparing one JSON file
with its Markdown, examples, attribution, rights, revision and archive state. Web
uses the existing Blob download; Expo uses its file-sharing adapter. The archive
of a linked former account now lists and exports its creator drafts individually,
limited to that former person and workspace. It does not copy private drafts into
the target workspace, grant editing authority or bundle every large body in one
response. Partial personal-memory exports/wipes explicitly exclude creator drafts.
There is no draft import/restore-from-export contract yet.

Seven isolated PostgreSQL cases cover creator ownership, missing/forged/live
authority, membership deletion, stale writes, state retries, simultaneous restores,
the active/retained quotas and former-account export isolation/revocation. Chrome
verification exported the fictional Cedarbay specialist and checked the downloaded
JSON, archived it, opened its formatted playbook with disabled editing controls,
found it in the archived list and restored editing. The desktop modal and 390×844
mobile sheet were visually checked. A session-loading race discovered during this
pass was fixed by waiting for the authenticated identity before opening the studio.

The structural pass reduced the enlarged draft component by moving example editing
and draft creation to their concrete owners. Six gating findings remain: short RPC
wrappers, similar bounded SQL projections and recent route/export churn. JSX usage
is not recognized by that scanner's dead-code report; the application's unused-code
check passes. No structural findings were suppressed.

The session-loading fix was also verified by delaying only Chrome's own session
request: the studio showed its loading state, then enabled the entry after the
request completed. The delay was removed after the test. Evidence is attached
with `gh --attach` to [PR 148](https://github.com/EnzoTironi/tryzoen/pull/148#issuecomment-5865808237).
The final general check passes 1,323 tests across 205 files, including type, lint,
format, unused-code and shared/mobile/desktop compile gates. Migration validation
and Expo exports for web/iOS/Android pass. Physical-device qualification,
production deployment and marketplace execution are still outstanding.

The final production build also passes after the session-loading correction.

## Private specialist previews — 2026-09-28

The creator studio can now submit a fictional question against an immutable copy
of a saved playbook and its attributed examples. Migration 0071 stores each
request, revision, snapshot, question, execution claim and terminal response in
an owner-scoped record. Editing or archiving the draft later does not change that
snapshot. Results reopen in the shared Markdown reader; individual JSON exports
include the exact source snapshot and response. These exports are review artifacts,
not an import contract or evaluation certificate.

The existing Eve coordinator receives only the request UUID. Its native workflow
authorizes that request, claims it once and passes the saved material directly to
a declared specialist. The specialist disables optional default tools and has no
authored memory, skills, connections or tools. Eve's `final_output` formatter is its
only advertised tool. It cannot receive coordinator-supplied prose, personal memory
or earlier conversation messages through this workflow. Its model selection checks
live human-session/workspace authority; recording a response checks authority again.
A second workflow cannot claim the request, and a late result cannot overwrite an
expired or completed result. Failure produces a failed preview with no invented
answer. A crash between the database claim and Eve's checkpoint can leave a request
uncompleted until expiry; it is never automatically re-admitted as a new execution.

Admission is one live request per person/workspace, ten in a rolling 24 hours and
100 retained requests. The studio shows the latest twenty for a draft. Preview
source material is limited to 48 KB of UTF-8 JSON without truncation, the question
to 4,000 characters and a saved answer to 32,000 characters. Requests expire after
five minutes. The child also uses the existing model deadline and Eve session and
usage limits; Eve's token/cost limits are between-call accounting limits, not a
hard cap on an individual provider response. The coordinator's existing model
and tools remain unchanged. Dispatch uses the normal agent turn, so failure to
invoke the preview tool can leave a request pending until it expires.

Six isolated PostgreSQL/Eve cases cover private membership/session isolation,
immutable snapshots and exports, stale input, simultaneous admission and claims,
late completion, explicit failure, rolling quotas, deletion cascades, actual root
memory/history exclusion and native workflow completion/provider failure. The
pinned Eve 0.63 compiler requires the workflow tool to be compiled as an authored
module; the fixture copies the actual tool source rather than re-exporting it.
The tool and hidden child use distinct names because this installed compiler
rejects their shared public name despite the documented `tool: false` exception.

Still required: model/version provenance and measured latency/cost on evaluation
receipts, held-out cases and human review, playbook synthesis, immutable publishing,
discovery, entitlements, withdrawal and creator outcome measurement. These previews
are not released marketplace bots. Partial personal-memory export/wipe explicitly
excludes preview records; membership/account deletion still cascades them. Former-
account archive export currently covers creator drafts, not their preview records.

The final general check passes 1,323 tests in 205 files, plus all nine workspace
checks. The production build, migration-chain check and Expo web/iOS/Android
exports pass. In Chrome, the fictional Cedarbay specialist answered an actual
question using the saved playbook; its immutable JSON export was downloaded and
checked for the response, revision, original example and source attribution.
Desktop modal, mobile sheet and read-only Markdown response views were inspected
at desktop size and 390×844. No production database or deployment was changed.

The structural report still has seven gating findings: separate typed export
formats and small RPC wrappers, recent feature wiring and component/adapter
length. The exports retain their distinct schemas and file formats instead of
introducing a generic export factory. The unused-code check passes; the structural
scanner's JSX/interface-method reachability findings are false positives. No
structural findings were suppressed and this is not a clean structural gate.

### Private memory relations checkpoint — 2026-09-28

Private learned notes now expose Akita’s typed relationships with the same
person/workspace isolation as recall. They stay in the original Markdown/Git
corpus; they are not creator knowledge, a marketplace discovery graph or shared
room memory. The specialist preview still receives only its frozen playbook,
examples and fictional question. This does not enable a specialist to read or
link the creator’s personal memory. See [file-memory implementation and limits](file-memory.md#private-typed-relationships--2026-09-28).

The previous preview checkpoint’s actual desktop/mobile images are attached to
[PR 148](https://github.com/EnzoTironi/tryzoen/pull/148#issuecomment-5866398125).

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

## Creator review of private previews — 2026-09-28

Migration 0072 adds one editable review to each completed preview. The creator
writes explicit criteria and explanatory notes in the shared visual Markdown
editor and chooses useful, needs revision, or unsafe/unsupported. The review has
its own revision and saved timestamp. It belongs to the original preview's frozen
playbook version, question and response; later draft edits or archival do not
rebind it. Reading a response cannot edit it, and saving feedback cannot publish
or change the playbook. Criteria here are written after a preview; this is not a
held-out, blinded or independently scored release evaluation.

The backend rechecks live human session and person/workspace ownership. Only a
completed preview accepts feedback. Owner serialization and revision checks
reject competing or stale updates; a lost-response retry succeeds without a new
revision only while its exact content is still current. Criteria are limited to
4,000 characters and notes to 8,000, with one current review per retained preview.
This does not retain a history of overwritten reviews. Database constraints keep
the payload bounded and disallow reviews on incomplete responses. Membership
removal cascades the review with its preview. The existing individual preview
export now includes the current review and its revision; former-account archive
export still needs explicit preview support.

The shared result card owns response reading, review and export. Desktop uses a
modal and mobile a sheet, with the full visual editor for criteria and notes.
An opening review retains its own revision while background refresh occurs;
failed saves keep the local draft and closing a changed review offers to keep it.
Four isolated review tests cover ownership, revoked sessions, immutable source
preservation, exact retries, concurrent/stale edits, incomplete previews, input
bounds, the database constraint and membership deletion. Together with the
existing preview and native Eve cases, ten isolated runtime tests pass.

All nine workspace checks pass, including 1,323 general tests in 205 files. The
production build, migration-chain check and Expo web/iOS/Android export pass.
Migration 0072 was applied only to the local review and isolated test databases.
Chrome saved clearly labeled synthetic feedback on the fictional Cedarbay case,
reopened its formatted notes and checked the downloaded JSON. A blocked save
kept the changed verdict and displayed an error; the interception was removed and
the unsaved test change discarded. No production deployment was performed.

The structural pass still flags two gating findings for the short typed RPC
adapter pattern. It also reports the new review's component length and complexity
(17), and fails to recognize JSX reachability. No findings were suppressed; the
unused-code check passes. These findings are not a clean structural gate.

Still required: a separate held-out case set with predeclared criteria,
model/version provenance, measured execution latency and cost, immutable release
reviews, creator-approved synthesis, publishing/discovery, entitlements,
withdrawal, outcomes and native-device/production qualification.

The desktop/mobile/editor and failure-state screenshots are attached with
`gh --attach` to [PR 148](https://github.com/EnzoTironi/tryzoen/pull/148#issuecomment-5867136130).

## Preview execution provenance — 2026-09-28

Migrations 0073–0074 record server start/finish timestamps and the SDK provider and
model identifiers selected by the private specialist. The UI displays the model
and elapsed time from workflow claim to the first saved terminal result; export
keeps both timestamps and provider/model pairs. This duration includes workflow
and provider work after claim, excludes waiting for the coordinator to start, and
is not pure inference latency. Expired or older previews without measurements
remain unknown. There is no manufactured zero, retrospective model guess or
backfill. A selected model identifier may be a provider alias; this is not proof
of a vendor's served weight revision. Token counts and provider-reported cost are
still missing and must not be represented as zero.

The installed Eve model resolver's context omits parent lineage. An authored
child hook therefore captures the public parent session/turn into a child-local
`defineState` slot. The resolver reauthorizes the human and records its selected
SDK model against that source before returning the configuration. This slot
never enters model instructions. One preview can claim a coordinator turn,
enforced by a unique database index. That prevents a late child from attributing
its selection to a later preview. The existing UI already starts a fresh
coordinator session for each preview. We do not parse Eve's opaque delegated call
IDs, read its internal state tables or put routing credentials in the prompt.

Only a running, unexpired preview owned by that person/workspace accepts model
observations. Up to eight distinct SDK provider/model pairs may be recorded;
repeated selections are idempotent, concurrent updates preserve that bound, and
exceeding it prevents another model call. Completed previews reject later
observations. No client mutation accepts model provenance, and the unchanged
claim/finish invocation binding still prevents competing workflows from running
or overwriting the same preview.

Eleven isolated PostgreSQL/Eve cases pass, including actual child lineage,
private-history/memory exclusion, provider failure, ownership, origin reuse,
concurrent model selection, duplicate observations, the eight-model bound and
late writes. In Chrome, a fresh fictional Cedarbay preview completed with the
configured `gpt-5.6-luna` model through `codex.responses`; its server duration was
2,910 ms. The two-sentence answer, immutable sources, model identifiers and
timestamps were verified in the downloaded JSON. This single run is functional
evidence, not a latency benchmark, capacity result or expert-quality evaluation.

All nine workspace checks pass, including 1,323 tests in 205 files. The production
build, migration-chain check and Expo web/iOS/Android export also pass. Both
migrations were applied only to local review and isolated runtime databases. The
structural pass still flags four gating findings: recent changes to claim/finish,
preview card growth and the generated migration journal. No finding was
suppressed; this is not a clean structural gate.

The verified desktop modal and mobile sheet screenshots are attached with
`gh --attach` to [PR 148](https://github.com/EnzoTironi/tryzoen/pull/148#issuecomment-5867496760).

## Private evaluation cases — 2026-09-28

A specialist now has a separate set of up to 20 private evaluation cases. Each
case has a title, question and predeclared Markdown criteria. Cases use the
shared visual editor and responsive modal/sheet; saving or removing one updates
a separately versioned case set without changing the teaching playbook or its
revision. Cases live under the existing person/workspace-owned draft, outside
its teaching content, and use its existing authorization and deletion cascade.
Archived drafts are readable, including their cases, but cannot be edited.

Before a saved case starts, the server verifies its case-set revision and exact
question, then freezes that case alongside the preview's teaching snapshot. The
workflow receives only the selected question and teaching content. It never
receives the rubric or other evaluation cases. A native Eve fixture inspects the
actual child model messages to prove these exclusions, alongside root-history
and personal-memory exclusion. Case edits/removals cannot rewrite an accepted
run, and a lost-response retry returns its original snapshot. Review criteria
for these runs are read-only; server validation and a database constraint reject
changing them after seeing the answer. Ordinary exploratory previews retain
their existing editable review criteria.

Only a live human owner can read or edit cases. Concurrent case edits use the
existing draft-write lock and an expected case-set revision; stale requests
cannot restore a removed case or replace a later edit. Questions and criteria
are bounded to 4,000 characters each, with unique case IDs and database payload
limits. No separate generic evaluation framework, agent, model call or extra
dependency was introduced. Draft exports, including the authorized former-account
archive, carry the case set; preview exports carry the frozen selected case.

This establishes separation of teaching and evaluation inputs, not guaranteed
statistical independence. A creator can still write overlapping material, and
repeatedly using a case makes it familiar. There is no hidden benchmark,
automatic expert score, release certificate or public marketplace. Immutable
release reviews, cost/token receipts, creator-approved synthesis, publishing,
entitlements, withdrawal, real-device qualification and outcome measurement
remain required.

Validation passes: 1,323 general tests in 205 files, all nine workspace checks,
production build, migration-chain check and Expo exports for web/iOS/Android.
Twenty-one unique isolated runtime cases cover creator authoring, former-account
export, evaluations, preview execution and review. Migration 0075 was applied
only to local review and test databases. The structural pass still has eight
unsuppressed gating findings: review/preview complexity, typed-RPC duplication,
recent preview changes and component/function growth. JSX reachability is not
recognized by that pass; the unused-code check passes. This is not a clean
structural gate.

Chrome saved a fictional quotation case, ran it, reviewed its predeclared
read-only criteria and exported its receipt. The first run failed with no saved
answer; its cause remains undiagnosed. A second run completed in 4,363 ms with
`gpt-5.6-luna`, refused fabricated attribution and offered discussion questions.
Both outcomes remain visible. The review is explicitly labeled as synthetic
feedback from the coding agent, not an expert certification. The exported JSON
contains the exact original case, criteria, teaching revision, model, timestamps
and review. A blocked case-save request retained the edited title and displayed
an error; the interception was cleared and that unsaved test edit discarded.
The responsive viewport override was cleared after evidence capture.

The verified desktop/mobile, fixed criteria, failed-save and response screenshots
are attached with `gh --attach` to [PR 148](https://github.com/EnzoTironi/tryzoen/pull/148#issuecomment-5867871597).
