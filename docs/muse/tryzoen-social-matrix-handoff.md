# Social/Matrix implementation handoff

The current cross-product backlog and execution order live in
[the parity roadmap](parity-roadmap.md). This document retains the decisions and
historical verification checkpoints behind that plan; later evidence supersedes
older gap descriptions.

On 2026-09-29 the user deferred further creator work and prioritized other product
features. Existing interviews and pilots remain, but new acquisition, publication
and monetization work is paused. Continue communication and personal-memory work
with one agent and proportionate validation.

Updated 2026-09-28 from the user-provided `tryzoen-social-matrix-handoff.md` and the HUMA and Tutor CoPilot PDFs. This reconciles that handoff with the running code; it does not replace Muse parity work or claim a completed social client.

## Direction and proposals

The user wants personal agents, official specialist/creator agents, real people and communities, with iMessage-inspired conversations and a desktop sidebar. Matrix is the chosen communication feasibility candidate. Eve remains the execution owner; Zoen owns accounts, grants, subscriptions, goals and published content.

The user clarified the creator experience on 2026-09-28: creating and teaching a bot must happen through a conversation with the agent. The primary social surfaces are a marketplace and a unified messaging interface for people, groups and bots, using iMessage, Slack and Ando as references. The approved navigation is recorded below; the photography pilot remains a proposal. Preserve existing Muse capabilities. Mark official AI identities clearly; a creator and their AI are different senders. Paid AI access does not imply unlimited personal access to the creator.

## Approved messaging implementation — 2026-09-28

The user approved the iMessage/Slack/Ando/Buzz concept, then explicitly retained
the original mobile bottom bar. Conversation, Feed, Ideas, Goals, Library and
Settings remain directly accessible. Discover is an entry in the conversation
list and desktop rail, **not** a mobile bottom-bar tab. There is no replacement
“My space” submenu hiding the original functions.

The shared React Native client now renders a persistent desktop conversation
list, existing pinned private chats, search and archive access, person/group/bot
filters, private pairs within a workspace, real groups and a conversation view. Mobile uses the same
list and a back action. Group replies open in a right-hand desktop thread pane
or a dedicated mobile view. Other sheets continue to use centered desktop
modals. Existing chat rename, pin, archive, export, agent activity/memory and
Markdown editor owners are retained. Web/Electron and Expo use thin adapters
to the existing session and room APIs; no second messaging runtime was added.

Conversation info now has an iMessage-inspired identity header, a group portrait
with the agent badge, real participant counts and a grouped participant list.
A compact action returns to the main conversation. The about section explains
agent mentions and private-memory boundaries without implying E2EE or presence.
It is a mobile sheet and a centered 480px desktop modal; its participant list
expands after six entries and the server projection remains bounded to 100.
Unimplemented call, video, notification and invite controls are not rendered.

Matrix rooms use native `m.thread` relationships and the v1 relations endpoint.
The current application user joins through the existing workspace membership
boundary. Every read/send checks live authorization; the thread parent must
belong to the selected room and cannot itself be a thread child. Stable
transaction IDs deduplicate a response-loss retry. Agent answers, native
message-tool output and approval/input cards inherit the requesting thread.
Reads are bounded to 100 events per page. TanStack infinite queries load older
pages near the top of group/direct conversations and threads, without a five-page
cutoff. The list remains virtualized and foreground queries poll every ten seconds.
Loaded pages remain in the query cache and TanStack refreshes them sequentially;
long-history cache/polling costs still need a measured sync/windowing rollout.
This is bounded HTTP polling, not yet a direct Matrix sync/E2EE client, and is
not a million-user throughput qualification.

Discover currently shows Zoen and the participant's accepted private creator
pilots, with search and resumable own drafts. “Create my bot” opens a drafted
chat request for an interview. The native Eve `creator-library` tool can list,
read and revision-safely save that person's private teaching draft, or read an
active pilot's selected teaching. It derives the actor from the session and
rejects group/protocol actors. A draft is not publication or evidence that linked
content was ingested. The existing visual editor remains available for review.

Still unfinished: a public/paid marketplace, cross-workspace human invitations
and complete direct-conversation lifecycle management, presence and voice/video hangouts,
resumable authorized YouTube/source ingestion, final bot identity routing,
entitlements and published knowledge deployment. Mobile group workspace
selection and physical-device transport/encryption recovery also need completion.
The concept's live hangout strip is deliberately not presented as an active
service. Native Akita dream and temporal limitations remain those documented in
[file-memory.md](file-memory.md); this change does not claim full Muse parity.

[Block's Buzz](https://github.com/block/buzz) is the additional open-source UX
reference for lightweight shared presence/hangouts. Its Nostr transport is not
substituted for the existing Matrix/Eve owners. Ando and Grok Bot marketplace
references below continue to guide participation and discovery.

### Verification checkpoint

The 2026-09-28 messaging and info-panel checkpoint passes `pnpm check`
(1,335 tests in 207 files; all nine tasks), `pnpm build`, and Expo exports for
web, iOS and Android. Compiled Eve creator/group/session-capture fixtures pass
11 cases; the final isolated Matrix-room case covers native thread replies,
retry deduplication and revoked access. These run against local synthetic data.
Chrome verification covers persisted thread replies after reload, separate
mobile/desktop thread layouts, opening/scrolling/closing conversation info,
direct Ideas/Goals/Library navigation, mobile settings, and the catalog's
"Create my bot" transition to a drafted interview in chat. The latest visual
pass uses the production build. It does not qualify physical devices or a live
model's interview quality. Screenshots are attached to PR 148 using `gh --attach`.

The structural delta still reports 24 unsuppressed gating findings, primarily
existing adapter-pattern matches, recent edit churn and function size. The
full application checks pass, but this is not a clean structural-quality claim.
No production migration, database reset or deployment is part of this checkpoint.

## Realtime ownership — clarified 2026-09-28

The user asked about Yjs, RxDB and Liveblocks, then clarified that Matrix should
be reused wherever it already solves the requirement. Do not introduce another
chat/presence service or replicate the same conversation into a second database.
[Matrix's Client-Server API](https://spec.matrix.org/latest/client-server-api/)
already defines sync, typing, read receipts (including threads) and presence.
Those capabilities must be wired to the client; having an installed homeserver
is not evidence that the current HTTP-polling companion already supports them.

Yjs is relevant specifically to simultaneous shared-document editing. The
[official Tiptap Collaboration extension](https://tiptap.dev/docs/editor/extensions/functionality/collaboration)
uses a Y.Doc and its own undo history. If/when that slice is implemented, qualify
its binding in both the web editor and native WebView, and authorize each document
against the existing owner/membership boundary. Never make private Akita memory,
creator teaching, approvals or account entitlements a generally writable shared
CRDT. File revisions and deliberate reviewed publication remain authoritative.

Liveblocks can host Yjs/presence, but would add a second service for communication
features already owned by Matrix. RxDB concerns local database replication; it
is not required merely to render live conversations. Its production SQLite and
Expo Filesystem adapters have licensing constraints documented by
[RxDB](https://rxdb.info/rx-storage-sqlite.html). No Yjs, Liveblocks, RxDB or extra
collaboration server dependency was installed for this change. The next sync
slice should qualify native Matrix sync and device-scoped recovery before adding
an offline database or a separate document collaboration service.

## Conversational creators and unified messaging — clarified 2026-09-28

This clarification supersedes the form-first creator journey and the standalone
“Help me respond” workflow inferred from Tutor CoPilot. That unfinished assistance
slice was removed before commit. The verified authoring, preview, approval and
private-pilot records described below remain reusable backend behavior; their
current screens are historical implementation checkpoints, not the final product
journey. Do not expand a parallel creator dashboard. Migrate complete flows and
their callers into chat, then remove the superseded controls. Keep the shared
visual Markdown editor for reviewing and directly editing generated files.

The intended creator journey is:

1. Start a normal conversation: “I want to create my bot.” The agent interviews
   the creator about audience, purpose, voice, methods, useful examples, limits
   and situations where the bot should ask for help. Ask focused follow-ups in
   context; do not replace the interview with a long form.
2. The creator connects their YouTube channel and supplies other authorized
   sources: documents, sites, posts, courses or uploads. The agent discovers the
   available inventory, reports progress and missing access, and asks about gaps
   and contradictions found in the material. Imported source text is evidence,
   never authorization or an instruction to the agent.
3. Build the bot's knowledge as files using the existing Akita engine: retain
   source material, create linked knowledge pages, and preserve provenance and
   revisions. Videos need attributed, timestamped transcripts and, when the
   method depends on visuals, separately supported visual extraction. Text
   indexing alone is not proof of understanding a demonstration in a video.
4. Exercise the bot in chat with the creator. Reuse immutable previews,
   predeclared evaluation cases and revision checks. The creator corrects the
   bot conversationally and can inspect the resulting files in the visual editor.
   Approve a concrete version and its included sources before publication.
5. Publish that approved bot in the marketplace. Its profile exposes identity,
   purpose, source coverage, version, access terms and an action to start a
   conversation or invite it into an authorized group. Buying access does not
   add the creator personally or disclose another subscriber's conversation.

“Index all my videos” is a resumable ingestion job, not a single unbounded model
prompt. Keep a per-source receipt with provider ID, origin URL, content digest,
source publication time, ingestion time, transcript segments, authorization and
processing status. Inventory, extraction, compilation and indexing are distinct
states; report inaccessible, unsupported and failed items rather than claiming
complete coverage. Reuse maintained provider integrations after registry and
license checks. The official [YouTube captions download API](https://developers.google.com/youtube/v3/docs/captions/download)
requires permission to edit the video; a public channel URL alone does not grant
that API access. Use authorized account access or creator-supplied material as
appropriate. Do not represent these importers as already implemented.

The [Akita architecture](https://github.com/akitaonrails/ai-memory/blob/main/docs/ARCHITECTURE.md)
provides file-authoritative wiki pages and derived retrieval indexes. Zoen still
owns source acquisition, publication, access enforcement and ingestion jobs;
Akita is not a YouTube importer or marketplace. Preserve both source dates and
ingestion dates without claiming that this alone implements complete bitemporal
queries. Current native dreaming and temporal limitations remain in
[file-memory.md](file-memory.md).

Maintain four separate knowledge boundaries: the creator's private interview
and drafts; the bot's explicitly published knowledge version; each person's
private conversations and memory; and each authorized group's shared context.
Neither a creator nor another subscriber gains access to private bot chats by
owning or subscribing to that bot. Group participation does not authorize access
to members' personal memories. Shared published knowledge can be reused across
authorized readers, but private learning and writes stay scoped to their owner.

The messaging surface uses the user's iMessage screenshots as concrete guidance:
conversation list with pinned people/groups/bots, search and filters; a message
timeline and composer; and conversation details with identity, participants,
attachments, notification preferences and leave/invite actions. Marketplace
discovery leads into that same conversation experience. Mobile sheets become
desktop modals. Muse goals, files, memory, approvals and other capabilities remain
reachable within the experience; this clarification does not remove them.

Matrix supplies room membership, message transport and synchronization; Eve
supplies agent execution and durable work; Akita supplies scoped memory; Zoen
supplies identity, marketplace publication, entitlements and the product UI.
The existing Matrix backend is a starting point, not proof of a complete native
client. An agent in an encrypted room must be an explicitly authorized recipient
with its own device keys and disclosed model processing. A server integration
does not automatically decrypt an encrypted room. Keep bot-to-bot turns bounded,
deduplicated and interruptible; room traffic must not create unbounded reply loops.
See the [Matrix components](https://matrix.org/docs/matrix-concepts/elements-of-matrix/)
and [encryption guide](https://matrix.org/docs/matrix-concepts/end-to-end-encryption/).

### Ando reference

The user supplied [Ando on X](https://x.com/andocorporation). That page could not
be retrieved in this inspection, so the product findings below use Ando's own
[website](https://www.ando.so/) and [introduction](https://www.ando.so/blog/introducing-ando),
read on 2026-09-28. They describe agents as conversation participants, support
agents from different runtimes, and emphasize shared context with controlled
attention. Examples include handing work between agents and returning previews
to a conversation for human review. These are vendor descriptions, not verified
Zoen capabilities or evidence of million-user capacity.

Use Ando for collaborative behavior: clear human/AI identities; humans and bots
in the same rooms; scoped side conversations; work handed off with attributable
results; and notifications that respect attention. Its stated private-message
boundary reinforces ours: joining a workspace does not grant access to DMs.
Do not infer a Matrix implementation, E2EE guarantees, source availability or
permission to copy vendor code from these product references. The creator
marketplace and conversational source ingestion remain Zoen requirements, not
features established by the Ando reference.

### Grok Bot Marketplace reference

The user also selected the [official Grok Bot Marketplace](https://x.ai/bot/marketplace).
Inspection on 2026-09-28 found search by creator or bot name, featured entries,
category navigation and cards with creator attribution, a concrete job and an
add action. Use those discovery patterns for Zoen. They are not evidence of a
paid marketplace, creator revenue model or a licensed corpus we can import.

The official [template guide](https://x.ai/bot/guides/templates-for-grok-bot)
describes a reviewed package of instructions, selected memories, skills and
plugins, with public or team sharing. The recipient starts a distinct copy and
must configure its own integrations. The [bot documentation](https://docs.x.ai/grok-bot/bots)
states that adding a shared bot does not provide the author's computer, logins
or conversation history. Use the inspect-before-add and explicit-publication
patterns, while enforcing Zoen's own stronger scoped-memory boundaries.

Zoen's creator offer is an approved knowledge version that a person can converse
with or invite into an authorized room. Do not silently interpret “add bot” as
permission to redistribute its paid source material, fork it, inherit credentials
or expose private conversations to its creator. A separately offered editable
template would need explicit distribution and update semantics. Public catalog
discovery, live bot access and exportable templates are different capabilities.

The reference map is: Muse for personal-agent capabilities; iMessage for a clear
conversation list and details; Ando for humans and agents collaborating in rooms;
Grok Bot Marketplace for discovery and inspecting a bot before adding it; Akita
for file-based knowledge and memory; Matrix for conversation transport; Eve for
durable execution. Creator onboarding, teaching and corrections happen in chat.

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
3. Implement conversational creator interviews, resumable authorized source ingestion and scoped bot knowledge; then publish approved versions in the marketplace, never a copy of the creator's entire personal memory.
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
5. **Use the bot in the normal conversation.** Apply approved teaching to bounded authorized context in a direct chat or group. Follow the user's later chat-based clarification above; Tutor CoPilot does not require a separate “Help me respond” screen. Advice, corrections and alternative approaches can be requested in the conversation. Autonomous community participation additionally follows the HUMA attention policy and its explicit room grant.
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

## Private approved creator versions — 2026-09-28

A live human owner can now review and approve a private version of a specialist.
Approval copies the teaching playbook, its explicitly authored sources, each
current evaluation case and its completed response, recorded model/timing,
creator review and approval notes. Later draft, case or review edits do not
rewrite this copy. The application exposes no update operation for approved
versions; this is not an administrator-proof database immutability guarantee.
Approval does not publish a bot or certify its expertise.

Every current case must have a completed, reviewed-as-useful latest run for the
exact teaching and case-set revisions. A newer pending, failed or unreviewed
attempt blocks approval even when an older useful result exists. The write
locks draft and preview changes in a consistent order, verifies live ownership
and rechecks the exact review revisions the person saw. Stale approvals cannot
silently accept different evidence. Identical retries return the same receipt;
the same ID with changed content cannot overwrite it. Reads and writes are
private to the account/workspace, including in multiplayer spaces, and reject
group-agent and protocol-task actors.

Migration 0076 stores at most 50 approved versions per owner/workspace, each
with at most 20 reviewed cases and a 2 MiB evidence bound. Existing account and
membership cascades retain their deletion behavior. The former-account archive
lists metadata and exports one authorized version at a time rather than loading
every evidence bundle. Normal export contains the same selected sources,
cases, responses, provenance and approval notes; it includes no personal memory
or unrelated conversations.

The review, saved-version and evidence views reuse the shared mobile sheet /
desktop modal and Markdown editor. The editor now honors a supplied save label
in visual mode, so the approval action is explicitly named. Chrome verified a
blocked save with notes retained, successful retry, reload persistence, read-only
approval notes and a downloaded receipt for the fictional Cedarbay fixture. The
approval expressly identifies the coding agent's synthetic verification and its
limits; it is not a human expert endorsement. Responsive viewport and network
interception overrides were cleared after verification.

Creator-approved synthesis, public listings and discovery, entitlement enforcement,
withdrawal, billing/cost receipts, specialist assistance in authorized conversations,
native-device verification and real-world outcome evaluation remain open. The
paper's human review and pilot process is not replaced by this approval record.

Validation passes: all nine workspace checks, 1,323 tests across 205 files,
production build, migration-chain check and Expo web/iOS/Android exports.
Nineteen isolated PostgreSQL tests in five suites cover approvals, evaluations,
reviews, previews and account archives, including concurrent retries, stale
reviews, revocation, cross-owner collisions and the 50-version limit. Migration
0076 was applied only to local review and isolated test databases. The structural
delta retains 26 unsuppressed gating findings for typed-wrapper similarity,
recent edits and component/function growth; JSX call reachability is also not
recognized by that tool. The unused-code check passes, but this is not a clean
structural or production gate.

The verified desktop/mobile approval and memory-navigation images are attached
with `gh --attach` to [PR 148](https://github.com/EnzoTironi/tryzoen/pull/148#issuecomment-5868523688).

## Proposed playbooks from authored examples — 2026-09-28

Creator studio can ask the existing isolated specialist to synthesize a Markdown
playbook from the draft's attributed examples and explicit creator guidance.
The source list is shown before generation. The server freezes those examples,
their provenance and the guidance under a distinct `playbook` task kind; it
omits the current playbook and rejects evaluation-case references. The existing
Eve workflow, selected model, origin binding, deadline, concurrency and usage
limits also govern these proposals. No second agent framework or model-facing
data access tool was added.

The specialist instructions ask for strategies, applicable contexts, alternatives,
limits and source attributions, while distinguishing supported observations from
tentative generalizations. The result is a proposal, not an asserted faithful
extraction of expert knowledge. Generation and completion do not write the
creator's playbook. A completed proposal opens in the shared visual editor;
the owner can edit it and explicitly choose “Use as playbook.” That uses the
existing revision-checked draft save. A stale or archived draft cannot be
silently replaced; adoption changes the teaching revision and therefore requires
fresh case runs before approving another version.

Proposals and answer previews share the per-owner limits and bounded history,
with the task kind preserved in their export. Approved evaluation evidence keeps
its existing receipt shape and can be drawn only from answer runs with current
evaluation cases. Existing approved copies are neither rewritten nor invalidated
by the new task discriminator. Migration 0077 adds that discriminator without
rewriting the applied chain.

Validation passes: all nine workspace checks (1,323 tests across 205 files),
production build, migration-chain validation and Expo exports for web, iOS and
Android. Twenty-two distinct isolated PostgreSQL cases across five suites cover
previews, evaluations, reviews, approvals and native Eve execution. Both task
kinds are exercised through a compiled Eve fixture: only the selected teaching
and question reach the child, with no root memory, history or evaluation rubric;
proposal input also excludes the old playbook. Migration 0077 was applied only
to the local review and isolated test databases.

Chrome verified an actual `gpt-5.6-luna` proposal in 18.9 seconds using the fictional
Cedarbay example. The response attributed its source and distinguished unsupported
adaptations. A simulated failed save retained edits; retry, reopen and exported
JSON verified persistence, unchanged examples and preservation of the original
model response. Adoption blocked approval until fresh evaluations, while the
previous approved copy still opened with its original playbook. Desktop modal
and mobile sheet/editor evidence is attached with `gh --attach` to
[PR 148](https://github.com/EnzoTironi/tryzoen/pull/148#issuecomment-5868878817).
This synthetic inspection is not expert endorsement or a creator-led pilot.

The structural delta retains six unsuppressed gating findings for recent edits
and component/function growth; it is not a clean structural gate. Model-assisted
synthesis and explicit private adoption are now operational. Public publishing,
discovery, entitlements, withdrawal, contextual assistance, cost accounting and
real creator-led pilot/outcome validation remain open.

## Named private creator pilots — 2026-09-28

An approved version can now be offered to a named person already in the same
shared workspace. The author reviews the exact playbook/examples and explicitly
confirms permission to share them. The recipient must accept before reading
that teaching or running the specialist. Invitations do not send email or chat
messages. Personal workspaces cannot host shared pilots. Both live organization
and workspace membership remain required; group/protocol actors cannot use the
human authoring or pilot endpoints.

The participant receives only the immutable approved teaching. Evaluation cases,
private approval notes, personal memory, room history and tools are not shared.
Questions, answers and reviews belong to the participant, not the author.
Existing isolated Eve execution, the participant's selected model, source
binding, model/timing receipt, visual Markdown editor and export are reused.
Pilot results cannot qualify a creator's predeclared evaluation cases. Editing
or archiving the source draft does not silently change or end an approved pilot;
the product directs the author to manage access separately.

Either party can withdraw. Declined or withdrawn invitations cannot reactivate;
a new explicit invitation is required. Identical retries preserve the original
receipt. Authorization locks serialize withdrawal with execution claims, model
receipts and result persistence, preventing a late response from being saved
after withdrawal. Membership deletion cascades the grant and participant results;
account archival explicitly withdraws its pending/active pilots. Previously read
or exported copies cannot be recalled, which the interface explains.

Admission is serialized per workspace with indexed, bounded participant/release
counts: 20 invitations per approved version and 100 sent/received per person in
a workspace, including closed pilots. Pilot runs share the existing per-person
preview limits (one active, 10 per day, 100 saved, five-minute expiration).
Metadata lists are bounded and do not load every teaching/evidence bundle.
Migration 0078 adds the grant and preview reference without rewriting applied
migration history. It has been applied only to local review and isolated test
databases.

Chrome verification found a real integration defect: a short, valid model answer
was rejected because the workflow required an additional structured-output tool
call. A compiled native regression reproduced the failure with plain model text.
The specialist now returns Markdown directly and exposes zero tools; the workflow
validates nonblank text and the 32,000-character bound before persistence. Native
tests cover normal answers, playbook proposals, participant isolation, provider
failure, blank output and oversized output. The same real browser request then
completed with `gpt-5.6-luna` in 1.8 seconds.

Desktop and mobile verification covered acceptance, source inspection, response
reading, WYSIWYG review, exported selected sources/model/private review, nonmember
invite rejection, and access withdrawal. A simulated lost connection retained
the unsent question, disabled new execution and recovered without losing the
draft. The synthetic fixture is explicitly fictional and the review identifies
itself as software verification; it is not an expert endorsement or a real
creator-led outcome evaluation. Verified screenshots are attached with
`gh --attach` to [PR 148](https://github.com/EnzoTironi/tryzoen/pull/148#issuecomment-5869523198).

All nine workspace checks pass (1,323 tests across 205 files), as do the production
build, migration-chain validation and Expo web/iOS/Android exports. The six
isolated creator suites now contain 30 cases; separate account/channel archive
checks cover the archive integration. The structural delta retains 21
unsuppressed gating findings for wrapper/component similarity, recent edits and
component/function growth; JSX reachability findings remain inconsistent with
the passing unused-code check. This is not a clean structural or production gate.

This implements invitation and private trial mechanics only. Explicitly submitted
participant feedback, real creator-led pilots/outcome measures, cross-workspace
distribution, public discovery/publication, entitlement/billing/cost accounting
and contextual assistance remain open. No production migration or deployment was
performed, and million-user capacity has not been measured.

## Explicit participant reports — 2026-09-28

Private pilots now expose a separate shared feedback document. The participant
writes observations, context, failures and observed outcomes in the existing
WYSIWYG editor and explicitly chooses “Share with [creator].” No private question,
model answer, evaluation criterion or review is copied into that report. The
creator can read and export only the submitted text with its pilot/release
metadata, and cannot edit the participant's report. Ordinary invitation lists
still contain bounded metadata, not all report bodies.

Each pilot stores one current report of at most 16,000 characters. Identical
response-loss retries preserve revision and timestamp; changed text requires the
exact opening revision. Concurrent updates cannot silently overwrite each other.
Writes require the named participant and an active grant. Closing the pilot
freezes updates but retains read/export for both parties while both remain live
workspace/organization members. Other workspace members, other workspaces,
group actors and protocol tasks are rejected. Already exported copies cannot
be recalled. Membership cascades retain the pilot's deletion behavior. This is
a revision-protected current document, not an append-only study dataset or
history of every report revision.

Migration 0079 adds the nullable document/revision/timestamp and their database
invariant without rewriting the applied chain. It has been applied only to the
local review and isolated test databases. The partial personal-memory export /
online-wipe descriptions now explicitly exclude creator releases and pilots;
they do not claim a complete account export or deletion.

Eight isolated pilot tests pass, including three new cases for explicit-only
sharing, creator/other-member read-write boundaries, invalid content/consent,
concurrent edits, retry stability, withdrawal and live membership revocation.
All nine workspace checks pass (1,323 tests in 205 files), as do the production
build, migration-chain check and Expo exports for web, iOS and Android. The
structural delta retains 12 unsuppressed gating findings for typed-wrapper and
query similarity and component/function growth, including increased complexity
in the pilot invitation UI. This is not a clean structural gate.

Chrome verification covered a failed submission with text retained, successful
retry, reopened persisted content, exported receipt, desktop modal/mobile sheet,
and a read-only report after withdrawal. A service-level read by the synthetic
author matched the participant's exported document and rejected an author edit.
Opening an existing report disables its actions while fresh access is being
checked, preventing stale cached status from offering an editable document.
Verified screenshots are attached with `gh --attach` to
[PR 148](https://github.com/EnzoTironi/tryzoen/pull/148#issuecomment-5869809117).
The content explicitly identifies itself as synthetic software verification;
no real creator-led pilot or effectiveness outcome was evaluated.

The HUMA/Tutor CoPilot path still requires real author-led iteration and outcome
measurement, contextual human-assist suggestions, distribution/entitlements,
public marketplace policy and billing/cost accounting. This report mechanism
supports that process without automatically opening private conversations to
a creator. Memory dreams/temporal completeness, native transports/devices and
full Muse parity remain separate unfinished work.

## Reflection must preserve later human intent — 2026-09-28

The [native dream qualification](file-memory.md#native-dream-qualification--2026-09-28)
now exercises Akita 2.4.1 with synthetic model responses, source history and
interruption. It reproduces two blockers for an active shared product: a pending
merge overwrites an acknowledged later edit, and can recreate acknowledged
deleted pages. Native cancellation finishes the current cluster before stopping
the next. These are executable race checks, not assumptions inferred from the
paper or a fabricated creator evaluation. Production dreaming stays disabled.

For HUMA's bounded reflection, native consolidation must run behind the current
owner/grant boundary. A staged proposal must retain its source revisions and be
rejected when any source or grant changes before apply. Pausing reflection cannot
mean allowing one final stale write to replace human intent. Account/room erasure
must cover staged snapshots, receipts that contain source content and in-flight
jobs as well as the active corpus. No raw person-to-person messages or private
pilot responses may be copied into a creator's playbook by this process.

Tutor CoPilot's author-led improvement remains a separate action over explicitly
provided examples and participant-submitted reports. Dreaming does not imply
permission to train on private pilots, edit authored SOUL/playbook instructions,
publish a new approved version or change a recipient's selected teaching. Public
distribution and real creator-led outcome measurement remain unfinished.

## Registered identity and shared message actions — 2026-09-28

People and creator bots now claim `@username` in one database namespace. Migration
0081 generalizes the existing directory: a row has exactly one human, creator
draft or registered system owner, and PostgreSQL derives its account type. There
is no bot suffix rule. A person named `something_bot` remains a person; Zoen's
registered system handle is reserved. Display names remain separate from handles.
Existing accounts and private drafts without a chosen username remain unclaimed;
there is no automatic renaming or imported-data backfill. The conversational
creator tool can claim or rename a handle with ownership and stale-write checks.
Private drafts and invitation-only specialists expose the chosen handle without
making their teaching or conversations publicly discoverable.

Groups and threads reuse private chat's reaction picker, copy and quote-reply
controls. Reactions are native Matrix annotations/redactions, counted per sender
and emoji; there is no parallel reaction database. Reads request at most twelve
visible message IDs, one hundred annotations each and three concurrent requests.
Truncated counts are explicit; the client refuses to edit a truncated set. Writes
validate the target, bound relation pagination and redact only the caller's
selected prior annotation. Retries reuse transaction IDs. Quote replies preserve
native `m.in_reply_to` and thread relations; unrelated thread targets are rejected.

Names, avatars and participant rows open a shared profile surface: bottom sheet
on mobile and centered modal on desktop. Profiles show public identity and the
shared conversation, never a participant's private memory or agent activity. The
old workspace-room renderer was removed; that route uses the same shared UI and
retains its administrator close-room control. The mobile navigation remains
Conversations, Feed, Ideas, Goals, Library and Settings; discovery stays elsewhere.

The visual target is the feel of a native Mac/iOS app across supported platforms:
system typography, restrained separators, rounded grouped surfaces, consistent
controls and platform-appropriate focus/keyboard behavior. Responsive Chrome
verification is not a substitute for signed-app and real-device qualification.

Remaining transport work includes native incremental Matrix sync, read receipts,
typing, push and offline recovery. Timeline and reactions still use bounded
foreground refreshes (10s and 30s), not a qualified million-user transport. Rich
media/calls/hangouts, public marketplace distribution and full Muse parity remain
unfinished. No production deployment or load-capacity claim accompanies this slice.

Validation for this slice: all nine `pnpm check` tasks pass (1,340 tests in 209
files), production build and Expo web/iOS/Android exports pass. Thirteen isolated
PostgreSQL/Synapse/compiled-Eve cases verify username races and type invariants,
creator ownership and conversational claims, former-account exports, reactions,
thread routing and revocation. Migration 0081 was applied only to the local review
and isolated test databases. Root authoring declares the same pinned Unicode
catalog as the shared UI because Eve resolves bundled imports from the root;
JSON imports carry the attribute required by Node 24. Browser proof includes
persistent reactions/quotes, actual copy/paste and desktop/mobile profiles.
Structural quality still reports 26 unsuppressed gating findings, dominated by
recent edit churn, adapter similarities and component growth. This is not a
clean structural-quality gate or complete production qualification.

## Conversation continuity — 2026-09-28

Opening a mobile thread previously unmounted the group composer and discarded its
unsent text. Room and thread composers now keep separate text, quote, pending-send
and retry state in the existing account/workspace-scoped query client. Reopening
a conversation restores that state; successful delivery clears only its own draft.
A failed send retains the original Matrix transaction until its text or quote
changes. Navigating during a send does not permit another concurrent submission.
A late success or failure cannot recreate data after the account cache is cleared.

This is navigation continuity within the running app, with thirty-minute inactive
cache retention. It is not durable offline storage, cross-device draft sync or
recovery after reloading/closing the app. Those remain explicit release work.
Draft text and quoted content are hidden while conversation access is unavailable.

The timeline preserves the reading position when older messages are prepended and
offers a compact button to return to recent messages. New messages received while
reading earlier content are counted on that button; this is a local viewport cue,
not a Matrix read receipt or an unread count shared across devices.

### Composer context and media — 2026-09-28

- The add menu is an anchored sheet immediately above the composer on both
  mobile and desktop. This is the explicit exception to the general desktop-modal
  rule. It keeps the text field usable, provides 44-point close and add targets,
  keyboard selection and dismissal, scrolling results, and no automatic motion.
- `@` searches room participants or discoverable usernames/bots and workspace
  files/artifacts; `$` searches published workspace skill paths; `/` lists visible
  saved routines. Suggestions are capped at 24 and scoped to the account,
  workspace and room. Choosing one inserts an identifier into the draft; it does
  not execute anything, share file contents, grant access or notify a person.
  Selected references appear inline with a blue highlight in the visual composer.
  The message carries the textual identifier, without Matrix notifications.
- Room searches use the existing shared-execution repository visibility rules,
  excluding private agent memory and other private paths. The existing personal
  directory discovery policy remains in force outside rooms.
- Group and thread drafts now include attachments. Matrix stores native `m.file`,
  `m.image`, `m.audio` and `m.video` events. Media downloads resolve a visible event
  on the server and recheck live membership, never a client-supplied URL. Files
  load on request rather than downloading an entire timeline.
- Web/Electron audio and video use browser controls. Expo uses the SDK-compatible
  `expo-audio` and `expo-video` 57.0.5 line, with local temporary playback files.
  No microphone or background-playback permission is added by this playback
  feature. Unsupported formats remain downloadable; arbitrary uploads do not
  acquire invented captions or transcripts.
- Current transport remains limited to four files totaling 3 MiB per composer
  submission. Large/resumable uploads, recording in the composer, generated
  captions and Matrix agent ingestion of binary attachments remain outstanding.
  Failed batches preserve their original event transaction identifiers; retries
  do not duplicate timeline events, but can create unused Matrix uploads before
  the homeserver returns an already-completed event transaction.

### Native conversation cards — 2026-09-28

- Agent conversations, groups and threads share rounded document/link cards.
  Native Matrix media expands on request. Loaded images, audio and video have
  no filename footer; the compact filename appears only before loading or as a
  fallback when an inline format is unavailable. Save controls remain adjacent.
  Images open an enlarged mobile sheet / desktop modal; text remains a separate
  bubble. Browser audio/video controls preserve playback and downloads.
- Public link cards show their domain immediately, with an explicit preview action
  for real HTML/Open Graph metadata. Previews are bounded to two URLs per message,
  deduplicated, and exclude inline/fenced code. The existing public HTTPS transport
  pins validated DNS, blocks private destinations and redirects, strips cookies and
  bounds each response to 512 KiB. Images use the same transport and only inert
  raster data is returned. Access is checked before and after retrieval; account
  cache retention is five minutes. There is no page execution or ambient login.
- Tool/app activity and authorization use the same card styling and existing states.
  This is presentation of existing Eve capabilities, not an interactive MCP Apps
  iframe host. Generic artifact browsing and large remote media still need their
  explicit authenticated platform adapters.
- Selected composer references are inline highlighted labels with type cues.
  Shared Tiptap/ProseMirror serialization replaces their internal label markup with
  the original identifier when sending; it does not send private file contents.
  Draft formatting and identifiers survive navigation. The highlighted label's
  presentation metadata is currently editor-local and becomes its textual identifier
  after the composer is remounted.
- Reused `linkifyjs` 4.3.3 (already in the dependency tree) and `htmlparser2` 12.0.0;
  these were the current stable registry versions at implementation time.

### Visual prompt editor — 2026-09-28

The connected web/Electron and Expo composers reuse Tiptap/TenTap, with a compact
retractable formatting toolbar for bold, italic, lists, quotes, code and links
(web also offers strike). References are inserted at editor positions, including
inside formatted paragraphs and after soft line breaks. The existing suggestion
sheet stays above the composer. Enter submits on web; Shift+Enter inserts a line
break, and IME composition never submits. Mobile keeps its native keyboard's line
break and explicit send button. Shared message rendering now displays Markdown
formatting for people as well as agents. Sending reads the editor's latest content;
failed delivery keeps it editable, and successful delivery clears its own draft.

Native adapters compile and export but still require physical-device verification,
including IME, selection, link insertion and long content. Native reference insertion
currently replaces the document through the TenTap bridge and restores selection;
undo continuity for that operation is not qualified. No new editor library or
collaboration engine was introduced.

Checkpoint verification: `pnpm check` passes all nine tasks, including 1,361 tests
in 214 files. The production build and fresh Expo web/iOS/Android exports pass.
Chrome verified formatted group/thread delivery, inline reference insertion after
a soft break, media upload through the real file chooser, playback, image opening
and a real Open Graph image/title preview. Desktop and mobile screenshots are
[attached to PR 148](https://github.com/EnzoTironi/tryzoen/pull/148#issuecomment-5875874232)
with `gh --attach`. The isolated PostgreSQL/Synapse messaging suite also covers
media authorization and identical-retry event deduplication. The structural delta
still reports 35 unsuppressed gating findings, including component growth, adapter
patterns and edit churn; no clean structural or production-capacity claim is made.

### Direct conversations between people — 2026-09-28

The new-conversation sheet searches the names and claimed usernames of people in
this shared workspace. A participant's group profile also offers **Mensagem**.
Both paths open the same private conversation for that pair. The inbox adds a
**Pessoas** filter; direct and group rows now use the existing virtualized list.
The direct header opens the peer's profile by avatar, name or info button. Profiles
remain mobile sheets / desktop modals and the original mobile bottom bar remains.

Migration 0082 adds only transport ownership, with one ordered pair per workspace
and composite membership foreign keys. Matrix owns all messages, attachments,
replies and reactions. Rooms use `is_direct` and both participants' `m.direct`
account data, in the existing application-service alias namespace. Pair locks
serialize simultaneous creation; ordered user locks protect identity writes and
account-data merges. Retried opens reuse the room and sends retain native Matrix
transaction IDs. No new messaging engine or dependency was added.

Access requires a live account session plus both participants' current workspace
and organization memberships. A third workspace administrator cannot list, read,
send to, react in or download media from the pair. No shared agent joins, and a
mention of Zoen does not enqueue agent work. Direct rooms are not group bindings;
private references remain explicit identifiers, not transferred files or grants.
Removing a membership removes the local pair binding. This revokes application
access; it does not claim to erase Matrix server history or copies already read.

This is direct messaging **within an existing shared workspace**. Global contact
invitations, blocking/reporting, direct-chat archive/delete/export, message previews,
activity ordering/unread state, read receipts, presence, calls and E2EE remain open.
Lists are bounded to twenty rows per cursor page and currently use stable room-ID
ordering; they do not claim a last-message order. Expo shares these components and
adapters, but native workspace selection and physical-device qualification remain
release work. The existing four-file / 3 MiB media bound still applies.

Verification: all nine `pnpm check` tasks pass, including 1,362 tests in 214 files;
`pnpm build` and fresh Expo web/iOS/Android exports pass. Three isolated
PostgreSQL/Synapse tests cover the existing group regression and new direct paths:
simultaneous creation, both sender views, account-data registration, send retry,
thread/reply/reaction/media delivery, third-admin denial, cross-room injection,
no agent ingress and membership revocation. Chrome verified username search,
profile-to-message reuse, direct/thread sends, reaction persistence after reload,
and 390px / desktop layouts against the production build using synthetic accounts.
The quality delta reports fifteen unsuppressed gating findings, primarily inbox and
profile growth, adapter-shape matches and recent edit churn. It is not a clean
structural, full-parity, E2EE or production-capacity qualification.

### Automatic Matrix conversation history — 2026-09-28

The previous-messages button is removed from group/direct timelines and threads.
The inverted virtual list opens at the newest message and requests older cursor
pages near its top. Older messages append at the far edge of the inverted data,
so extending history preserves the reading position. Measured item separators
replace container gaps so React Native Web's wheel bounds include row spacing.
The latest-messages shortcut returns to the newest edge.

TanStack Query owns page requests and cursors. Paging waits for background fetches
and uses `cancelRefetch: false`; null/repeated cursors stop loading, including
empty Matrix pages that only contained reactions or thread replies. The previous
five-page cutoff is gone. Tests use a real InfiniteQueryObserver to load seven
pages, stop at the end, coalesce simultaneous requests and reject cursor loops.
The UI retains authorization error handling and scoped room/thread caches.

The combined direct-conversation/pagination delta retains 20 unsuppressed
structural findings (component growth, recent churn and adapter-pattern matches);
the scan is not claimed clean.

Verification: `pnpm check` passes all nine tasks (1,364 tests, 214 files),
`pnpm build` passes, and fresh Expo web/iOS/Android exports pass. In the local
production build, a synthetic Matrix conversation with 151 initial messages and
110 thread replies was paged to its beginning on desktop; the thread loaded all
110 replies. The mobile viewport also crossed page boundaries and kept its
bottom navigation. After an additional incoming message, the three visible rows
retained exactly the same measured vertical positions (187.5, 373.5 and 559.5px).
The latest shortcut showed the new message. Web scroll anchoring supplies the
behavior missing from React Native Web's maintainVisibleContentPosition; native
uses the platform implementation. Physical-device scrolling remains unqualified.

### Integrated parity checkpoint — 2026-09-28, wave 6

The active delivery is PR 152 on `codex/conversation-parity`. The later verified
slices supersede the earlier open-item list above: global activity-ordered inbox
pagination and bounded native Matrix sync, private read markers, own-message
editing/deletion, saved references with exact event context and participant
profiles, plus focused-room typing are implemented. Matrix remains the source of
message content, relations and private account data. These slices do not yet
qualify notification counts, full gap reconciliation, offline, push, E2EE or calls.

Creator teaching and evaluation use the chat workflow. Approved versions freeze
reviewed sources and an Akita 2.4.1 corpus; private grounded evaluations preserve
exact excerpts and reject invalid citations. A real synthetic chat test retrieved
the fictional source, correctly abstained from inventing a novel quotation and
saved the review separately. Grounded evaluations cannot qualify or silently
change existing snapshot pilots. Public publishing, YouTube ingestion and
creator-qualified grounded pilots remain open.

Shared settings now work inside the Expo panel with named overlays, keyboard focus
containment on web, channels, credential delegation and signed-in sessions. Vault
CRUD, provider onboarding and physical-device qualification remain separate work.
The mobile navigation remains visible; the web overlay is a modal on desktop.

Wave 6 passed `pnpm check` (245 files / 1,518 tests), `pnpm build`, database
migration validation and Expo web/iOS/Android exports. Isolated runtime coverage
includes five Matrix and nineteen creator tests. Structural findings remain
recorded, without suppression. See [the parity roadmap](parity-roadmap.md) for
current acceptance criteria, evidence and the three parallel implementation lanes.
No production database was reset and no full-parity or capacity claim is made.

### Integrated parity checkpoint — 2026-09-28, wave 7

The subsequent slice qualifies native Synapse notification counts on the isolated
homeserver. Human appservice identities are nonexclusive for native push rules;
a Synapse module blocks reserved-identity registration and interactive/SSO login.
Bot identities remain exclusive. The application feature is off by default and
requires a qualified deployment. Encrypted bounded cursors retain native counts,
re-bootstrap on scope changes and hide unknown counts during failures. Browser QA
verified incoming preview/count changes and receipt-driven clearing after the
message was actually visible. This is not OS push, global unread-message counting,
gap reconciliation, offline storage or E2EE.

Creator qualification now records exact approved release, corpus digest,
evaluation revision and human-reviewed grounded cases. At least one declared
supported case and one declared insufficient-evidence case must pass; changes to
evidence invalidate qualification. Explicitly qualified new pilots use grounded
responses, while existing snapshot pilots keep their behavior. Revocation and
membership are checked around execution; participant conversations remain private.
Base private-release review/approval is also available through native chat
questions with readable teaching, examples, provenance and review notes. Runtime
tests cover qualified pilots; browser evidence covers synthetic base approval,
not a real creator endorsement or marketplace publication.

The web and Expo vault share bounded listing, masked details, creation and
confirmed removal. Authorization is transactional, secret drafts never enter the
mutation cache and cancellation/background clears sensitive drafts. Local
validation preserves editable values; uncertain transport failures clear secrets.
Editing, revealing and payment-provider setup remain separate work. The completed
question-card lifecycle and rich composer clearing also work in the running UI.

Wave 7 passed `pnpm check` (251 files / 1,558 tests), `pnpm build`, migration
validation, Expo web/iOS/Android exports and the focused isolated runtime suites.
Same-major security patch overrides leave `pnpm audit` without known advisories.
Migration 0089 is local/test only. Nine verified screenshots and their clearly
labelled screenshot-sequence video accompany PR 152; physical devices remain
unqualified. Structural findings are recorded without suppression in the roadmap.

### Integrated parity checkpoint — wave 8

Wave 8 implements native search within one
authorized Matrix conversation, human-reviewed creator Markdown/text uploads and
automatic TanStack agent-history pagination. Search revalidates every hit and
opens exact authorized context. The source hook accepts only a newly submitted
human file for an armed, bounded intake; content/rights approval remains separate.
Adding an evaluation case preserves omitted cases; explicit removal asks the
human. History preserves the visible reading position while prepending and keeps
the active Eve stream separate from immutable older pages.

Browser QA verified search/context/draft preservation at desktop and mobile
sizes, source review through the real conversation, continued memory-tool use
after an attachment, and automatic history in both chat surfaces. Compiled
regressions cover the two memory failures uncovered by that walkthrough: missing
continuation IDs in native Akita ingestion and non-JSON SDK media in Eve's durable
memory callbacks. A local runtime patch handles media in history and turn input
without changing the strict validation of other context fields.

Next operational work is fair, bounded namespace ingestion with isolated failure,
durable retry and measured throughput. Continue with one agent as requested. The
public-marketplace, external-source, device, offline, encryption, calling and
capacity gates in the roadmap remain open.

### Session delivery isolation — wave 9

Memory archive delivery commits one authorized namespace at a time. Failed
accounts retain exact pending sources and durable backoff; healthy accounts keep
their acknowledgements. Bounded batches rotate waiting accounts, new capture
cannot bypass a failed head, and concurrent workers skip locked namespaces.
Organization membership is fenced alongside workspace access. The unchanged
native Akita engine still verifies ingestion and immutable file replay.

See the [delivery and measurement contract](file-memory.md#fair-session-delivery-and-durable-retry--2026-09-28).
The local capacity harness uses only disposable synthetic data in the isolated
runtime database. Minute-cadence fan-out and production-volume capacity remain
unqualified; this delivery fix is not a million-account result.

### Foreground recovery and scheduled delivery — wave 10

One Eve invocation can now execute several bounded archive rounds. The validated
concurrency override defaults to one worker; overlapping ticks share their local
promise, while database locks isolate accounts between replicas. Failed batches
back off and remain visible after healthy work finishes. See the
[scheduled delivery contract](file-memory.md#bounded-scheduled-delivery).

Room and thread reads now consume TanStack cancellation through the actual tRPC
transport. Background/offline transitions cancel only that scoped conversation
and invalidate it for authorized resume. Drafts remain editable while sending is
paused; returning online restores sending. Browser verification covered desktop,
mobile, separate thread drafts and a real synthetic message after reconnect.
These are navigation drafts, not durable offline storage or a background outbox.

The isolated Synapse test covers a native limited sync plus 136 ordered messages
across two history pages and rejects subsequent reads after membership revocation.
Large-burst scroll-position retention and efficient content deltas remain open.
The behavior relies on the existing [Matrix history model](https://spec.matrix.org/unstable/client-server-api/#room-event-format)
and [TanStack sequential infinite refetch](https://tanstack.com/query/latest/docs/framework/react/guides/infinite-queries);
no duplicate message store was added. Validation: 1,603 application tests, build,
three Expo exports and 14 focused isolated runtime tests passed. Full parity and
million-account production capacity are still unqualified. Continue with one agent.

### Credential editing and revocation — wave 11

The shared vault form now handles creation and editing, with no creation-only
alias. An explicit cancellable POST reads a selected revision into local editor
state; decrypted payloads do not enter TanStack caches. Sensitive fields hide
after 30 seconds; backgrounding or five minutes closes the editor. The server
rejects stale edits, preserves item IDs and atomically replaces encrypted content
while revoking prior grants. Grant creation and replacement share a workspace
lock. Native payment and new-password hints avoid misclassifying card fields as
login credentials. Authenticated tRPC responses are private and not cacheable.

Delegated-secret reads now reuse the central workspace/organization/personal-owner
membership predicate, retaining locks through decryption. Regression tests proved
the previous stale-membership access before the fix. Full principal authentication
still belongs to the caller; the extracted membership check is not a substitute
for authenticating a session, channel, schedule or grant.

Desktop/mobile browser checks used only synthetic credentials/cards. A preexisting
local test item could not decrypt and was left intact; a newly created item was
updated and read back successfully. Physical-device and payment qualification,
step-up authentication and production capacity remain open. Continue without
subagents as requested.

Validation: 1,611 application tests, the build, three Expo exports and the complete
isolated runtime suite (414 tests / 105 files) passed. The test database alone was
recreated before that run. [Wave 11 visual evidence](https://github.com/EnzoTironi/tryzoen/pull/152#issuecomment-5883295480)
contains four screenshots and a labelled screenshot-sequence video, attached
with `gh --attach` after verifying the running build. The latest blank card form
did not autofill site credentials; reopening the synthetic item after restart
preserved its saved content.

### Durable memory erasure — wave 12

The erasure queue now acknowledges one partition per transaction and persists
bounded exponential retry metadata on failure. Other accounts still complete;
workers skip locked receipts. Account request locks serialize final acknowledgement
across concurrent namespace workers. Only `file_memory` is marked erased when
all that account's receipts are gone; historical provider obligations stay intact.
Interrupted filesystem deletion is replayable without losing the receipt.

The Eve schedule awaits up to eight batches of five each minute within a 45-second
soft budget and shares overlapping in-process ticks. It does not abort an active
filesystem operation. Additive migration 0092 adds retry metadata and its index.
The new regression was reproduced against the earlier implementation; six new
runtime cases plus existing memory/corpus tests passed (28 total).

[A local query measurement](evidence/memory-erasure-query-2026-09-29.json) used a
million delayed receipts plus one eligible receipt. One index search returned
one row in 0.017 ms; the synthetic transaction was rolled back. This measures a
warm queue selection only. It does not qualify filesystem throughput, placement,
replicas or million-account operation. Checks passed with 1,614 tests and the
build passed. Migration 0092 was applied only to the local isolated/review databases.
The full runtime suite passed (106 files / 420 tests), as did the migration check.
[The actual Eve cron experiment](evidence/memory-erasure-cron-2026-09-29.json)
confirmed healthy progress, durable failure and successful retry after repairing
a synthetic marker and restarting the app, without changing retry timestamps.
The existing account's learned notes remained available in both browser sizes;
[screenshots and a labelled screenshot sequence](https://github.com/EnzoTironi/tryzoen/pull/152#issuecomment-5883517046)
were attached with `gh --attach`. No new memory UI was introduced in wave 12.

### Shared memory cards and document editor — wave 13

Personal notes, learned memories and historical excerpts reuse the shared resource
card and Markdown renderer. Private previews disable remote images; unsafe URLs
remain non-interactive text. Existing authorization, confirmation, relationship
and history behavior is retained.

Personal notes now use the visual editor. The old plain textarea screen has been
removed from `DocumentEditor`; non-Markdown files and a missing visual adapter
use the existing source editor within the same shell. Save reads the current
editor handle, validates length and closes only after successful persistence.

Verified production UI at desktop and mobile viewport sizes, visual editing and
unsaved-change discard. A real Akita query returned an earlier synthetic memory
excerpt, then closing history restored the current note. `pnpm check` passed
267 files / 1,624 tests, `pnpm build` passed, and Expo exported all platforms.
This client-only change does not rerun or replace wave 12's 420 runtime checks.
Screenshots and a labelled screenshot-sequence video were attached with `gh --attach`.
Native-device and production-capacity qualification remain open.

Evidence: https://github.com/EnzoTironi/tryzoen/pull/152#issuecomment-5883699640

### Reaction lifetime and visibility — wave 14

Room and thread reactions now observe active/online state and local overlays.
The hidden room timeline pauses when a narrow thread opens. Cancelled reaction
queries propagate their AbortSignal through the shared transport. Delayed reads
cannot start a write after the view loses ownership; already accepted writes do
not overwrite a reopened view's cache. Retries retain the same operation ID.

Five regressions were reproduced against the previous implementation. Eighteen
focused tests and the full application check (268 files / 1,632 tests) passed,
as did the production build and Expo exports. No server procedure or database
changed; wave 12 remains the latest full isolated runtime qualification (420 tests).

The production UI persisted a synthetic reaction across reload and shared it
with the mobile thread, then removed it through that thread. The bottom bar
remains visible. [Network evidence](evidence/reaction-visibility-2026-09-29.json)
records three background-modal reaction reads in 86.2 seconds before the fix,
zero in 51.4 seconds after it, and resumed fetching on close. Global settings
overlays and incremental message-history sync remain separate open work.
[Four screenshots and a labelled screenshot sequence](https://github.com/EnzoTironi/tryzoen/pull/152#issuecomment-5883888398)
were attached with `gh --attach`. This is not a production load qualification.

### Room changes and typing share native sync — wave 15

The typing-only reader is replaced by `readMatrixRoomSync` and the shared
`useRoomSync` hook. One bounded native long-poll covers typing and timeline-change
signals. The old read contract was removed from server, adapters and web/mobile
callers. Publication still belongs to `setMatrixTyping` and its existing publisher.

Room/thread history queries no longer refetch periodically. A change or reset
invalidates the matching history and awaits active sequential refetch before
acknowledging the sync cursor. If pagination is already in flight, its work is
left intact and that sync cursor is replayed. Inactive history remains stale.
Errors show a reconnecting notice and revalidate history authorization. Background,
offline and disposal continue cancelling the observer.

[An idle browser measurement](evidence/room-sync-2026-09-29.json) changed from five
history reads plus five typing reads in 48.5 seconds to zero history reads plus
four combined sync reads in 49.6 seconds. Synapse checks covered new, edited and
redacted messages, limited timelines and revoked membership. QueryClient tests
cover pending pagination, delayed results and failure propagation. Application
checks passed (1,644 tests), as did build and three Expo exports.

Incremental content application is still open: actual changes currently refetch
loaded pages. This is reduced idle work, not million-user capacity qualification.

A second review tab delivered a new synthetic message and thread reply without
reloading the receiving desktop/mobile views. Three screenshots and a labelled
screenshot sequence were [attached with `gh --attach`](https://github.com/EnzoTironi/tryzoen/pull/152#issuecomment-5884262828).

### Global panels suspend covered observers — wave 16

The shared shell exposes content visibility to inbox and Matrix room/thread
lifecycle owners. Settings and Agent Activity pause covered sync, reactions and
history. Closing revalidates access and resumes; online/focus events cannot
restart a hidden observer. Delayed responses are ignored. The composer keeps
its draft without a misleading reconnecting hint. Eve execution and the agent
panel's own data are not stopped.

[The production-build browser observation](evidence/global-visibility-2026-09-29.json)
measured 8 room-sync, 3 reaction and 11 inbox-sync reads behind Settings in 106.7
seconds before the fix, and zero in 62.2 seconds afterward. Agent Activity also
kept covered queries at zero in 76.6 seconds. Closing resumed all four query
families including history; the inspected sync response was HTTP 200 / ready.
A synthetic draft survived both transitions.

Combined waves 15/16 validation passed: application check 268 files / 1,647 tests,
production build, all Expo exports, and the full isolated runtime suite with
107 files / 421 tests. Initial full runs exposed two fixture races: initial
Matrix membership projection and repeated parked events during interview restart.
Fixtures now await confirmed projection and the next question/completed action;
production authorization and workflows were not weakened.

Four actual screenshots and a labelled 20-second screenshot sequence were
[attached with `gh --attach`](https://github.com/EnzoTironi/tryzoen/pull/152#issuecomment-5884555065).
Structural review reports 31 observations, 16 gating, without suppressions.
Incremental content patching, native-device and production-capacity qualification
remain open. Do not infer throughput or million-account readiness from idle UI.

### Incremental content application — wave 17

Focused native sync batches now project new events, validated edits and thread
roots into the existing infinite caches. Batches hold at most 20 events and exact
relationship reads run at concurrency four. Authorization is checked again after
projection. Concurrent local writes or pagination replay the unacknowledged cursor;
inactive queries remain stale. The 200-message live-head cap, redactions, membership
changes and gaps use sequential history recovery without fabricating native cursors.

[Browser measurements](evidence/incremental-history-2026-09-29.json) found zero
history reads for a new arrival, an edit and a mobile thread reply. Three arrivals
kept an older reading anchor within 0.1875 px and the new-message button reached
the final arrival. These are synthetic functional comparisons, not load tests.

Application check passed 270 files / 1,664 tests, production build and all Expo
exports passed, and three focused isolated Synapse tests passed. The previous full
runtime suite passed 421 tests at `86ed2531`; the next CI run repeats it. An unchanged
QuickJS cancellation test timed out once, then its 18 focused tests and the whole
check passed without weakening assertions. Structural review remains open with
11 observations / six gating. Large-burst recovery, bounded total cache retention,
physical-device qualification and production capacity remain release gates.

Six screenshots and a labelled 24-second screenshot sequence were
[attached with `gh --attach`](https://github.com/EnzoTironi/tryzoen/pull/152#issuecomment-5884911784).

### Compact message presentation — wave 18

Shared room actions now wrap in one row, with quieter icons and 44 px action
and thread targets. Conversation Markdown owns no duplicate outer paragraph
padding but separates blocks; document previews keep their layout. A short
message measures 166 → 110 px on desktop. Copy feedback, quoted reply/removal,
persistent reaction, mobile thread navigation and visual rich-text editing were
verified against the production build. Mobile bottom navigation remains visible.

Check passed 270 files / 1,664 tests, as did build and all Expo exports. A narrow
React Native test mock was updated to the web adapter without removing private
image/link assertions. No server or database behavior changed. Quality delta:
four observations, zero gating; the reported unused separator is a library callback.
[Five screenshots and a labelled screenshot sequence](https://github.com/EnzoTironi/tryzoen/pull/152#issuecomment-5885161314)
were attached with `gh --attach`. [Local measurements](evidence/message-density-2026-09-29.json)
do not qualify physical devices, enlarged text or the smaller profile-name links.

### Native reaction invalidation — wave 19

Room sync now includes native reaction events and returns a scoped invalidation
signal. Reaction-only batches do not reload history. The independent 30-second
reaction timer is removed. A pending older reaction read holds the cursor until
fresh counts are applied; inactive query variants become stale, reset recovers
the views, and authorization failures invalidate both history and counts.
Cross-room native events are rejected. Removal still follows conservative
redaction history recovery.

The production-build browser comparison found five idle reaction reads / 169 s
before versus zero / 424 s after. A second-tab addition caused one count read and
zero history reads; removal caused one of each. Observed 448/321 ms timings
include automation, not an SLO. [Measurements](evidence/reaction-sync-2026-09-29.json).
Check passed 270 files / 1,669 tests; build and Expo exports passed. Three focused
real Synapse tests cover separate-account counts/removal, access loss and prior
message/edit/thread/gap behavior. Eight structural observations remain, including
six churn gates; no suppressions. No database change.

[Four screenshots and a 16-second screenshot sequence](https://github.com/EnzoTironi/tryzoen/pull/152#issuecomment-5885515822)
were attached with `gh --attach`. Physical devices, full parity and production
capacity remain unqualified.

### Reviewed native message forwarding — wave 20

Existing same-workspace DMs/groups are discoverable with authorized SQL, stable
20-item cursor pages and literal name/username search. The shared UI requires
selection, content review and explicit confirmation. The server rechecks both
memberships and the reviewed revision, copies only allowed content to a native
Matrix transaction, verifies its receipt and marks it forwarded. It strips source
attribution, quote/thread relations and mention instructions. Forwarded content
does not invoke the agent; file bytes remain on the existing native media owner.

Production-build browser verification covered username search, draft preservation,
text delivery, identical downloaded file and an original changed in another tab.
The old preview blocked sending until explicit review; the updated copy arrived.
[Measurements](evidence/message-forwarding-2026-09-29.json) and [seven screenshots plus a labelled screenshot sequence](https://github.com/EnzoTironi/tryzoen/pull/152#issuecomment-5885992122).
Check passed 272 files / 1,687 tests, production build and all Expo exports passed.
Two isolated real Synapse tests cover another member, DM isolation, revocation,
retry, paginated destinations and file access after source redaction. All six CI
checks on the preceding `f59d7c9a` passed. No dependency or migration was added.
Structural review: 28 observations, nine gating; no suppressions.

This is one reviewed copy at a time within a workspace. Lost acknowledgement plus
subsequent source editing requires inspecting the destination and reviewing a new
version; no global exactly-once claim. Physical devices, bounded total history
retention and production-capacity qualification remain open.

### Verified native removals and automatic recovery — wave 21

Native redactions now read and verify the exact target, including room, event
kind and homeserver confirmation. Reaction removals invalidate counts without
history recovery. Loaded main-message removals patch a tombstone while retaining
page cursors. Unknown targets, stripped edit ancestry and removed replies still
recover history to retain valid content and thread counts. Exact reads retain
the existing concurrency bound of four.

Browser verification exposed a reconnect loop being disabled by its own history
error. The authorized observer now keeps its backoff while private content stays
hidden. Stopping and restarting the production server recovered the conversation
and its draft without reload or manual retry. A second-tab message removal and
reaction removal each caused zero history reads. Observation windows include
automation and are not latency measurements; an invalid deletion baseline was
discarded. [Measurements](evidence/redaction-recovery-2026-09-29.json).

Check passed 272 files / 1,701 tests, production build and all Expo exports passed.
Three isolated real Synapse tests exercise reaction/edit/reply/root removal,
gap recovery and revocation. All six CI checks on `b6b31ea1` passed. No dependency
or migration was added. Structural review: seven observations / one churn gate,
without suppressions; the local classifier has complexity 24. Six actual captures
and a labelled 24-second screenshot sequence were [attached via `gh --attach`](https://github.com/EnzoTironi/tryzoen/pull/152#issuecomment-5886337421).
Bounded total history, large bursts, physical devices, full parity and production
capacity remain open.

### Per-person native conversation mute — wave 22

Group details and direct-conversation profiles now expose the same notification
control in desktop modals and mobile sheets. It mutes new alerts, including
explicit mentions, until reactivated. Messages remain available. Loading and
save failures are visible; an uncertain save requires a fresh read before editing.

`server/matrix/notifications.ts` owns an exact-room, per-person native override
rule with empty actions. The native Matrix rule is the authority; no duplicate
preference table was introduced. A person/room advisory transaction lock serializes
writes, a desired boolean makes repetition safe, and access and saved state are
verified again. The shared schema/RPC adapter serves web, Electron and Expo.

The running build was checked for group mute, close/reopen persistence, reactivation
and direct mute at desktop and 390 × 844 mobile sizes. Both synthetic preferences
were restored. [Five screenshots and a 15-second screenshot sequence](https://github.com/EnzoTironi/tryzoen/pull/152#issuecomment-5887210251)
were attached with `gh --attach`; this is not a continuous recording.
[Evidence record](evidence/conversation-notifications-2026-09-29.json).

Check passed 272 files / 1,701 tests, production build and all Expo exports passed.
One focused real PostgreSQL/Synapse test covers notification counts, explicit
mentions, repeated writes, reactivation, person/room isolation and rejected
unauthorized reads/writes. All six CI checks on `f45e300d` passed. No dependency
or migration was added. Structural review: 16 observations / five gates, without
suppression; direct RPC adapter patterns and existing size/churn remain visible.

Further creator work is deferred. The bounded-history experiment is excluded
because gap traversal and reading-position preservation need separate qualification;
existing infinite pagination remains. This does not supply native OS push,
offline delivery, physical-device or million-user capacity qualification.

### Administrative group-name editing — wave 23

Group details now offer a shared desktop modal/mobile sheet for renaming to
administrators. Ordinary members do not see the action; the server enforces
the existing administrative, workspace and session boundaries independently.
Errors preserve the proposal. A stale expected name returns a conflict and
requires explicitly loading the latest name before editing again.

`server/matrix/group-name.ts` writes and verifies native `m.room.name`, then
updates the existing SQL binding label under the membership advisory lock.
The room ID and epoch stay unchanged. Successful repetition is safe; concurrent
product edits are serialized. The existing native sync filter now observes
name events and triggers authorized history recovery. Local caches patch room
metadata while retaining messages and page cursors; no new observer or store.

The running production build confirmed administrator editing, member visibility,
remote inbox/conversation updates without reload, an unchanged unsent draft,
and conflict recovery between two windows. The synthetic name was restored and
the temporary draft cleared. [Five screenshots and a labelled 15-second sequence](https://github.com/EnzoTironi/tryzoen/pull/152#issuecomment-5887918856)
were attached using `gh --attach`. [Evidence record](evidence/group-name-2026-09-29.json).

Check passed 272 files / 1,701 tests; production build passed. Two focused real
PostgreSQL/Synapse tests cover native state, remote sync, retries, concurrent
edits, failed native writes and authorization. All six checks on `a7137cef`
passed. No dependency or migration was added. Expo exports were not repeated
in this increment; this is not physical-device qualification. Structural review
has 13 observations / three gates, without suppression: direct RPC wrappers
and existing component size remain visible; the new component has a JSX caller.

The native write and SQL projection are not a distributed transaction. A failure
after the native write is visible and can require retry; there is no global
exactly-once or external Matrix-client CAS guarantee. Additional creator work,
full parity and production capacity remain outside this completed increment.

### Workspace group participation — wave 24

Shared participant management now supports leave and administrator add/re-add or
remove of existing workspace people. Current workspace-wide discovery remains
for people who have never left; this is not external invitations or independent
private-group ACLs. Workspace admins cannot be removed by these controls.

`server/matrix/membership.ts` owns the native and application lifecycle using the
existing room advisory lock. The SQL projection retains departed membership;
reads cannot auto-rejoin it. Departure denies product access before native leave
or kick. Persisted pending/due state is reconciled by the existing Eve delivery
schedule: ten due entries, one-minute retries, and a 30-second budget for starting
work. Current native membership is verified; delayed callbacks cannot undo a
newer authorized join. Initial join reuses the same bounded native state read
instead of enumerating every joined member.

Inbox, history, media, inbound sender authority and group-agent authorization
honor departed state. A focused revoked room is excluded from inbox sync rather
than breaking that sync; a fresh authorization denial yields an empty `denied`
room-sync result. Stale epochs still retry rather than reporting permanent loss.
The UI hides history/composer on denial and offers a return to conversations.
Voluntary leave retains only the user's draft among room query caches.

Check passes 272 files / 1,703 tests. Five real PostgreSQL/Synapse tests across
three suites cover lifecycle, isolation, preserved messages, native retirement
failure/recovery and delayed callbacks. Additive migrations 0093–0094 have been
applied only to isolated runtime and local review databases. No dependencies were
added. Native and SQL writes are not a distributed transaction; pending native
retirement is visible rather than silently treated as complete. Further creator
work remains deferred; this increment does not claim complete parity, native OS
push, E2EE or production capacity.

Wave 24 visual verification and production build passed. Administrator removal,
re-addition with preserved history and mobile leave confirmation were checked;
the synthetic memberships were restored. [Visual evidence](https://github.com/EnzoTironi/tryzoen/pull/152#issuecomment-5889635406)
was attached with `gh --attach`. [Record](evidence/group-membership-2026-09-29.json).
Draft preservation on leave was not separately proven visually.

### Optimistic delivery and navigation caches — wave 25

`conversation/outbox.ts` owns a bounded TanStack-backed local queue; native Eve
and Matrix remain the delivery authorities. Enqueue clears the composer and
accepts another message immediately. Errors/retry stay on the affected message;
late responses never restore over the next draft. Matrix text/file transactions
retain their operation IDs on retry and reconcile exact own-event transaction
IDs, including partial media delivery. Eve correlates its public response stream's
receipt to the local echo, never text. The live projection waits for outstanding
receipts when the continuous stream outruns a POST acknowledgement; collection
continues. Uncertain Eve sends require manual review/retry because public delivery
identity/idempotency options are unavailable in the pinned SDK.

The persistent companion layout owns account-scoped QueryClient lifetime; its
workspace provider still isolates workspace changes. Providers clear on unmount,
queued sends check cache ownership before starting, and late mutation results
cannot recreate cleared entries. Native browser history changes section query
parameters; session route changes retain server authorization. Live session
history and drafts use the same cache and resume at the existing cursor. Default
inactive retention is 30 minutes. Feed likes and native mute use serialized
optimistic mutations. Global textfield styles include dialog portals, with quiet
neutral focus and a forced-color fallback.

The running build verified group/thread/agent bursts under 3.5-second simulated
latency, continued typing, unique confirmations and draft retention. Cached Feed
and chat reopened without loading screens under five-second latency. Desktop,
390x844 mobile and modal focus were inspected; no console errors. [Five images
and a labelled 15-second screenshot sequence](https://github.com/EnzoTironi/tryzoen/pull/152#issuecomment-5889698768) were attached with
`gh --attach`. [Record](evidence/instant-messaging-2026-09-29.json).

Check: 273 files / 1,704 tests; production build passed. Five focused real
PostgreSQL/Synapse tests passed. Structural review records 47 observations / 28
gates without suppression, primarily owner size/complexity/churn; the delivery
indicator is shared. No new dependencies/migrations in this wave. Expo exports
and physical-device testing were not repeated.

The queue is memory-only, capped at 20 entries per conversation. Reload/crash
persistence, fully offline delivery, global layout stability and production
capacity are not supplied by this increment. Cold visits still load data.
Creator expansion remains deferred.

### Durable local drafts and outbox — wave 26

This supersedes wave 25's memory-only queue limitation. `conversation/persistence.ts`
subscribes to successful TanStack updates for four explicit local query families.
It restores before mounting composers, persists separate outbox records, batches
draft removal and queue admission atomically, and awaits disk commit before a
transport starts. `session/draft.ts` shares draft ownership between new and
existing agent conversations. Pending transport promises/options remain ephemeral.

Platform adapters use `idb` 8.0.3 (MIT) and `expo-sqlite` 57.0.3 (MIT, Expo SDK 57
bundled version). Session-scoped reads/writes are bounded to 200 records / 32 MiB;
browser transactions maintain usage counters rather than reading payloads on each
keystroke. Logout revokes local session scopes and deletes records atomically,
including protection against another tab's late write. Native network state feeds
TanStack's online manager. Unrelated server caches and credentials are excluded.

Matrix recovery occurs when its conversation opens, using the original operation
and per-file transaction IDs. It may replay an uncertain native PUT safely. Eve
has no public equivalent idempotency key in the pinned SDK; unknown submissions
recover as failed/reviewable, with no automatic agent replay. Receipt-bearing
entries reconcile with native history. Removing a failed local echo does not
redact a delivered remote event. The initial session still uses Eve's atomic
owner-establishing create rather than speculative prewarming.

Browser evidence closes an offline tab with a queued synthetic message, opens a
fresh tab and verifies exactly one native message plus the next retained draft.
It also verifies group reload and a new-agent draft on reload, and inspects the
390×844 layout. Native SQLite/device execution and cold offline boot are not
claimed. [Record](evidence/durable-messaging-2026-09-29.json).

Regression coverage exercises session isolation, logout revocation, independent
tab entries, atomic quota rejection, uncertain-agent recovery and commit failures.
The previous CI's two Matrix sync failures expected an exception after membership
revocation; they now assert the deliberate `denied` result with empty content.
Corrupt/replayed cursor and unauthorized typing checks retain their rejection
expectations. The focused real PostgreSQL/Synapse suites passed (3 tests).

References: [idb](https://github.com/jakearchibald/idb),
[Expo SQLite](https://docs.expo.dev/versions/latest/sdk/sqlite/).
Remaining gates include account-wide background draining, cold offline startup,
physical-device validation, encrypted local storage, push/E2EE/calls, global cache
retention and demonstrated production capacity. Creator expansion remains deferred.

Visual evidence attached with `gh --attach`: [screenshots and screenshot sequence](https://github.com/EnzoTironi/tryzoen/pull/152#issuecomment-5890406756).
Validation: `pnpm check` (274 files / 1,710 tests), `pnpm build`, and the three
isolated Matrix runtime tests passed. Structural review recorded 41 observations /
10 gates without suppressions; existing owner complexity/size/churn remains visible.

### Compact actions, touch gestures and native presence — wave 27

`conversation/interaction.tsx` owns bubble anchoring, desktop context/keyboard
access, touch hold and right-swipe reply through existing RN PanResponder/Animated.
`message-actions.tsx` supplies real capabilities and grouped items; the existing
reaction picker renders a 304 px desktop popover or compact mobile sheet. Its
lazy fallback no longer inserts a loading row into a message. Private agent chat,
Matrix rooms and threads share the interaction surface. Long-press release
suppresses the compatibility click before it can land on a new sheet item.
Reply changes focus the current composer while preserving its draft.

`server/matrix/presence.ts` owns native account-data opt-in and presence writes.
Default is off. An advisory lock serializes privacy changes/heartbeats; explicit
opt-out is written before offline so another active client cannot republish.
Room sync filters at most 100 authorized human participants, revalidates membership
after the native long poll, emits only sender/state, and reuses the ephemeral
client sync map with 30-second expiry. Background/offline/unmount clears state.
`set_presence=offline` remains on native sync; only the consent-aware heartbeat
publishes online. Do not replace this with typing heuristics or a SQL presence loop.

`conversation/connection.tsx` adds a non-layout-shifting offline/reconnect overlay.
Paused TanStack mutations derive queued delivery state without persisting promises
or changing transport records. No new database table or migration is needed.

Validation: check 274 files / 1,712 tests; production build; three isolated real
PostgreSQL/Synapse suites (4 tests); Expo web/iOS/Android exports. Exports preceded
the final web long-press click suppression; final check/build include it. Compatible
Expo patch cohort upgraded to expo 57.0.26, constants/modules-core 57.0.20,
document-picker 57.0.3. pnpm release-age exceptions name only these exact versions.

Browser verification covered the private agent, groups, thread menus, native
reaction selection, touch hold/release, swipe reply, focus and draft preservation.
[Five screenshots and labelled mobile screenshot sequence](https://github.com/EnzoTironi/tryzoen/pull/152#issuecomment-5891392313)
were attached using `gh --attach`. [Record](evidence/message-interactions-2026-09-29.json).
Structural quality reports 34 observations / 15 gates (no quality acknowledgements):
JSX size/complexity, sync growth and repeated settings layout remain visible.

Remaining: real-device gesture/accessibility qualification, media-control gesture
policy, draggable-sheet dismissal, haptics, configurable double tap, per-message
unread/pinning/report actions and full reactor details. Controls inside media/link
cards keep their native interactions and expose actions through the ellipsis.
Native push, E2EE, calls, cold offline boot, background draining and production
capacity are still release gates. Creator expansion remains deferred.

### Native message organization and Sliding Sync — wave 28

- `server/matrix/reactions.ts` reads bounded annotation pages and resolves only
  authorized member profiles; room authority is checked again before returning.
- `server/matrix/pins.ts` owns native pins, authorization, a 50-entry limit and
  reviewed-revision conflicts. Group writes require workspace management rights;
  DMs honor Matrix power levels, including v12 creator authority. The advisory
  lock serializes Zoen writes, not third-party Matrix clients.
- `server/matrix/read-position.ts` serializes private reminders with receipts.
  Marking unread never rewinds fully-read position; visible main-timeline reads
  clear the marker, while threaded reads retain their own receipt scope.
- Shared `rooms/reactors.tsx`, `rooms/pins.tsx` and the existing compact menu own
  the UI. Mobile sheets and desktop modals reuse the shared primitives.
- Inbox metadata now uses `sync/sliding.ts`, bounded to the authorized visible
  head (31 rooms, one event each, 1 MiB response). Unique connection IDs avoid
  cross-tab connection collisions. Opaque positions travel inside the existing
  account/session-bound encrypted cursor. M_UNKNOWN_POS gets one fresh bootstrap.
  Account data and room state are stripped to the fields needed by the UI.
- `chats/notifications.ts` reconciles TanStack notification snapshots while
  preserving concurrent optimistic reminders. Unread rollback changes only the
  reminder and preserves newer native notification counters.

The installed Synapse v1.160.0 advertises simplified Sliding Sync. Its filtered
v3 sync discarded room account data, confirmed against the running server and
its FilterCollection implementation. The new inbox endpoint requires
`org.matrix.simplified_msc3575`; do not silently fall back to a full-account sync.
Reference: https://github.com/matrix-org/matrix-spec-proposals/blob/main/proposals/4186-simplified-sliding-sync.md

MSC4306 thread subscriptions are present but disabled in the running homeserver.
Follow-thread notification parity remains open; do not call a bookmark a native
subscription or present its controls as active without a tested server rollout.
No database migration, new dependency, or production deployment in this wave.

### Private message links — wave 29

Shared `rooms/links.ts` owns a validated canonical web locator containing the
room UUID, exact Matrix event and workspace. The room schema and every SQL
projection now carry workspaceId; the real inbox integration asserts it.
Compact message actions copy the link only for committed, non-redacted messages.
Web and Expo supply their application origin through the existing adapters.

`app/companion/connected.tsx` rejects ambiguous query parameters and opens the
existing authorized `RoomMessageContext`, including the thread-root affordance.
Closing removes the message parameter through native history without reloading
or discarding the room draft. Auth callbacks retain the destination query. No
URL provides a public capability and no new read endpoint bypasses membership.

Check: 275 files / 1,721 tests, nine tasks. Build passed. Separate isolated real
Postgres/Synapse runs cover context authorization and inbox workspace projection
(two files / two tests). Browser desktop/mobile verified exact event targeting,
thread root navigation, clean sidebar and retained draft; zero console errors.
[Evidence](https://github.com/EnzoTironi/tryzoen/pull/152#issuecomment-5892527473) includes screenshots and a labelled screenshot sequence.
Structural delta: 23 observations / 11 gates, zero acknowledgements.
OS-level universal/app links and private Eve message links remain open.

### Message gestures — wave 30

`conversation/double-tap.ts` recognizes intentional touch pairs and uses the
existing reaction transport. `gesture-preferences.tsx` owns a device-only TanStack
preference; platform storage adapters contain no account content. Mouse selection,
interactive children, scrolling and long presses keep their existing semantics.
Read coordinates from `nativeEvent.touches`, including on React Native Web.
`sheet-drag.tsx` is shared by SheetSurface and the compact ReactionPicker. Its
44px grabber owns the drag, leaving scrolling and document selection untouched.
Short or cancelled drags reset; desktop dialogs are unchanged.

Check passed: 277 files / 1,726 tests, nine tasks; build passed. Expo all-platform
exports preceded the final web touch fix; browser plus final check/build cover
that fix. Browser proved actual Matrix reactions, saved preferences, offline error
and retry, short/complete drags, and retained drafts. Physical devices and haptics
are not qualified. [Visual evidence](https://github.com/EnzoTironi/tryzoen/pull/152#issuecomment-5892916585).
Structural delta: 26 observations / 10 gates, zero acknowledgements.

The remote full runtime suite caught an unread-count regression: this Synapse's
Sliding Sync returns dummy zero counters. The follow-up must source counters from
bounded v3 sync while keeping native account-data markers. Do not suppress the
notification integration test or treat a zero from Sliding Sync as authoritative.

### Authoritative native notification counters — wave 31

The wave-28 Sliding Sync migration regressed counters: Synapse 1.160.0's handler
hardcodes zero. `sync/counters.ts` reads bounded v3 sync for authoritative push-rule
and receipt counts. `sync/sliding.ts` joins that stream with metadata/account-data
in parallel. Both positions travel in the same existing encrypted scope-bound
cursor. Dummy sliding fields are discarded; each response is independently size-
and scope-checked, and leave events win over stale joins. No local counter, room-
by-room fan-out or account-wide sync was introduced.

The full remote suite first caught an outdated equality missing markedUnread;
fixing the expectation exposed the real zero-counter regression locally. Isolated
notification and organization suites now pass (two files / two tests). Check:
277 files / 1,729 tests and nine tasks passed. The initial check/build hit ENOSPC;
only regenerable Next/Homebrew caches were removed, with user data preserved.
Source: https://github.com/element-hq/synapse/blob/v1.160.0/synapse/handlers/sliding_sync/__init__.py
Final production build passed after cache cleanup. This correction does not
change the rendered UI; wave 30 visual evidence still covers those components.

### Optimistic reactions — wave 32

Both reaction hooks use TanStack mutations and pending mutation projections;
confirmed query data remains untouched until the provider accepts the write.
Mutation scopes serialize room writes across timeline/thread instances. Native
replacement reads the latest confirmed event ID at execution time, preserving
existing idempotent retry. Private-agent reads normalize missing reactions to
null for the requested bounded page. Success updates loaded pages without an
immediate redundant refetch. Shared interaction owns error display while menus
close immediately; unsuccessful previews disappear without rewriting the cache.

Check: 278 files / 1,733 tests and nine tasks; build passed. Browser desktop and
390×844 confirmed immediate menu close/preview at 2.5-second latency, rollback
offline, retry, retained drafts, private-agent persistence and touch reactions.
[Evidence](https://github.com/EnzoTironi/tryzoen/pull/152#issuecomment-5893325236).
Structural delta: ten observations / six gates, zero acknowledgements. Reactions
are explicitly retryable, not persisted in the message outbox. No production changes.

### Native thread subscriptions — wave 33

`server/matrix/thread-subscriptions.ts` owns MSC4306 GET/PUT/DELETE with provider
capability detection, root validation, actor/room/root serialization and membership
revalidation. The shared thread button uses TanStack pending state and confirmed
cache; failure offers readback before another toggle. No duplicate persistence.
The isolated server and generated configuration enable the experimental feature;
production is unchanged. See infrastructure/matrix/README.md for compatibility
and changed notification semantics. Room mute still overrides followed threads.

Two isolated runtime tests passed (notifications and subscriptions). Full serial
check: 279 files / 1,736 tests, nine tasks; build passed. Initial parallel checking
hit host resource pressure; serial checking passed without altered test deadlines.
Browser confirmed instant pending state, reload persistence and mobile unfollow.
[Evidence](https://github.com/EnzoTironi/tryzoen/pull/152#issuecomment-5893689261).
Structural review: 17 observations / eight gates, no acknowledgements. Followed
thread inbox, automatic subscription on reply and background push remain open.
CI for preceding commit 757a6057 passed all six jobs before this push.

### Message reports (wave 36, 2026-09-29)

DM/group/thread menus now expose an explicit selected-event report with a
reviewed reason. The native Synapse queue owns moderation; a private PostgreSQL
admission receipt prevents duplicate provider POSTs and caps new admissions at
ten per rolling day. Lost acknowledgements remain uncertain without automatic
retry. Human sessions, membership and exact message revisions are checked.
Migration 0095 is additive and was applied only to isolated/review databases.
See `docs/operations/matrix-moderation.md` for admin review and retention limits.

Real PostgreSQL/Synapse tests passed, as did the full check (280 files / 1,740
tests, nine tasks), build and desktop/mobile browser review. Shared radio/tab
controls now expose actual selection in React Native Web through native-supported
ARIA aliases. Evidence: https://github.com/EnzoTironi/tryzoen/pull/152#issuecomment-5895341092.
Blocking, appeals, staffing and review SLA remain separate release gates.
