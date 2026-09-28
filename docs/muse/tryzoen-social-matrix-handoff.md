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

Still required: draft lifecycle/archival and account-merge export qualification,
model-assisted playbook synthesis, version-bound held-out evaluation, immutable
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
