# Social/Matrix implementation handoff

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
list, existing pinned private chats, search and archive access, group/bot
filters, real workspace groups and a conversation view. Mobile uses the same
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
Reads are bounded to 100 events per page and five loaded pages per open timeline;
the list remains virtualized and only visible queries poll every ten seconds.
This is bounded HTTP polling, not yet a direct Matrix sync/E2EE client, and is
not a million-user throughput qualification.

Discover currently shows Zoen and the participant's accepted private creator
pilots, with search and resumable own drafts. “Create my bot” opens a drafted
chat request for an interview. The native Eve `creator-library` tool can list,
read and revision-safely save that person's private teaching draft, or read an
active pilot's selected teaching. It derives the actor from the session and
rejects group/protocol actors. A draft is not publication or evidence that linked
content was ingested. The existing visual editor remains available for review.

Still unfinished: a public/paid marketplace, direct human-to-human invitations
and conversation management in this shell, presence and voice/video hangouts,
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
