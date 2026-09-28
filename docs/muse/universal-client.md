# Zoen’s universal companion

The product target is the complete Muse experience: its interaction model and visual detail, together with real, durable behavior. Zoen remains the product and backend. Electron is the desktop host; Expo is the mobile host. React Native components render through React Native Web on desktop and web.

The client now connects the main Muse-style surfaces to durable Zoen data. It is **not full Muse feature parity**. It must remain an opt-in route until the acceptance work below is complete.

The [interface audit](interface-audit.md) records the observed screens, nested menus, platform differences and behavior gaps. Use it as the parity checklist. In particular, Muse's editorial Feed, personalized Ideas and four-tab agent-status surface are broader than the current connected sections.

The shared settings panel now uses the reference row order and a rounded compact sheet, with a centered desktop dialog. The web adapter keeps the underlying screen mounted and connects General, Connectors, Wallet, Credential vault, Permissions, Messaging channels, Devices and Data controls to existing account operations. Vault reads use 20-item keyset pages and only return masked metadata. Devices currently lists authenticated app/browser sessions, not OS pairing. Permissions currently controls credential delegations, not all browser/network grants. Help and legal information remain basic; native mobile settings still need the shared panel adapter. This is not full settings parity.

The avatar now opens a four-tab agent panel without replacing the conversation. Activity and approvals can be reviewed per conversation using the existing paginated Eve history. Upcoming reads real schedules and supports revision-checked pause/resume. Identity opens the real workspace IDENTITY.md, SOUL.md and MEMORY.md files, with revision-checked visual editing. Account profile and personal notes remain separate from workspace identity and are also accessible from settings. Desktop docks the panel beside the active conversation; compact layouts use a sheet. This does not yet provide Muse's global task/approval timeline or avatar customization.

The [file-memory adoption plan](file-memory.md) records the user's 2026-09-28 decision to adopt Akita's file-authoritative model, relations, ingestion-time `as_of` and opt-in dreams. Eve retains execution and PostgreSQL retains account/product ownership. The current Mem0/profile implementation has not yet been replaced; isolated upstream acceptance is separate from application integration. The [social/Matrix handoff](tryzoen-social-matrix-handoff.md) applies the same private/published/community boundaries.

## What runs now

- `/companion` uses the shared welcome screen and composer against Zoen’s existing Eve channel. `/companion/:sessionId` checks account/workspace ownership before loading a conversation.
- Existing conversations reuse Zoen’s paginated history, reconnect, stream, cancellation, and approval handlers. The new view renders Markdown, tool progress, authorization links, approval options, and freeform questions. It does not create another agent runtime.
- The shared shell keeps conversation search, feed, ideas, goals, library and settings inside the companion. Ideas now persist personal proposals and feedback, show rationale and task details, and start a deduplicated conversation on approval. Asking for more ideas prepares an editable message; autonomous generation and ranking remain open. Goals read saved workstreams and support revision-checked completion; the library opens and edits persisted workspace files. Feed pages show personal editorial posts with sources, rationale, reactions, deletion and quoted discussion. A shared visual editor saves personal Feed instructions with revision checks. Generation can be requested conversationally or explicitly included in an authorized scheduled task; autonomous generation remains open. Search and Feed use bounded keyset queries.
- Electron has native menus, a single application instance, and a `Cmd/Ctrl+Shift+Space` show/hide shortcut. Its sandboxed renderer stays on one configured origin. External HTTPS links open in the system browser; files, application protocols, and credential-bearing URLs are rejected.
- Expo uses Better Auth’s native adapter with SecureStore and the same Eve session controller as web. It supports account sign-in, live conversations, bounded history, approvals, cancellation and the connected product sections. Native OAuth requires a configured Google client and a registered `zoen://` callback; a real iOS/Android device sign-in remains a release gate.

The desktop renderer currently loads the hosted application. It is not an offline, packaged renderer or an OS automation engine. Google OAuth requires the browser handoff described below; this change does not claim embedded Google login works.

## Ownership

| Owner                            | Responsibility                                                                                                                                       |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/companion-ui`          | Platform-neutral React Native views and interaction state. Public declarations do not expose native renderer types into Next’s DOM type environment. |
| `app/companion`                  | Web authentication, routing, workspace context, and adapters to the existing Eve client.                                                             |
| `apps/desktop`                   | Electron window lifecycle, native menus, validated origin policy, packaging. No general-purpose IPC bridge.                                          |
| `apps/mobile`                    | Expo startup, safe areas, secure account cookies, authenticated API transport and native file editing.                                               |
| Existing `agent`, `server`, `db` | Identity, permissions, persistent records, execution, provider integrations, and side-effect idempotency.                                            |

Expo’s Xcode project dependency is constrained to the patched CommonJS-compatible `uuid` 11.1.1 release; its only UUID call is `v4()`. This preserves the existing dependency audit gate.

Expo 57 uses Babel 7. The mobile host therefore pins the resource-management transform to 7.29.7 (Babel 8 requires a separate Expo compatibility upgrade). It transforms Eve’s `await using` declarations before async lowering, and imports only the Core-js disposal symbols, async iterator symbol and promise resolver built-ins required by Eve’s stream lifecycle. See [Babel’s transform documentation](https://babeljs.io/docs/babel-plugin-transform-explicit-resource-management).

The shared UI has a compilation boundary so React Native’s global `FormData` and timer declarations do not overwrite browser/server types. Expo resolves shared components to its own React instance. Root Turbo tasks are explicitly registered so adding workspace packages cannot silently skip the existing backend checks.

## Versions and reuse

Versions were checked against npm and the Expo SDK manifest on 2026-09-27. Prefer the newest stable release that works with the complete target stack; verify upgrades in CI and retain a reproducible lockfile.

| Component                 | Selection       | Constraint                                                                                                                                                                           |
| ------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Next.js                   | 16.3.6          | Latest stable patch at verification.                                                                                                                                                 |
| Electron                  | 44.4.5          | Latest stable at verification.                                                                                                                                                       |
| electron-builder          | 26.15.3         | Use its existing macOS, Windows, and Linux packaging support.                                                                                                                        |
| Expo                      | 57.0.25         | Latest stable SDK at verification.                                                                                                                                                   |
| React Native              | 0.86.3          | SDK 57’s supported release; standalone RN 0.87.1 is newer.                                                                                                                           |
| React / React DOM in Expo | 19.2.3          | Exact SDK recommendation. Next keeps its existing 19.2.8 instance.                                                                                                                   |
| TypeScript in Expo        | 6.0.3           | Exact SDK compatibility line; backend keeps TypeScript 7.                                                                                                                            |
| React Native Web          | 0.21.3          | Latest stable, within Expo’s supported range.                                                                                                                                        |
| Lucide React Native       | 1.48.0          | Reuse the existing icon family across platforms.                                                                                                                                     |
| react-native-marked       | 8.3.2           | Reuse Markdown rendering, with a narrow web-URL policy for generated links and images.                                                                                               |
| Eve                       | Existing 0.63.0 | Latest is 0.67.2. Its removal of run modes and agent-level output schemas requires a runtime migration and verification of existing patches. Do not upgrade only the package number. |

Reference: [Expo SDK 57](https://expo.dev/changelog/sdk-57), [Electron security model](https://www.electronjs.org/docs/latest/tutorial/security), [React Native Marked](https://github.com/gmsgowtham/react-native-marked).

[OpenMuse](https://github.com/CopilotKit/openmuse) is a useful MIT-licensed reference, not a replacement backend. Its UI is coupled to CopilotKit’s protocol and its browser/task services. Preserve provenance and licenses if individual components are adopted. No OpenMuse code or Muse proprietary assets have been copied in this foundation.

Use [Better Auth’s Electron integration](https://better-auth.com/docs/integrations/electron) for the pending system-browser authentication flow. [Its Expo integration](https://better-auth.com/docs/integrations/expo) is already installed for native sign-in and secure session storage; real-device verification remains required.

## Running locally

```sh
pnpm install --frozen-lockfile
pnpm --filter @zoen/companion-ui build:ui

# Connected shared interface; requires the normal local backend configuration
pnpm preview:companion
# Open http://localhost:3000/companion
ZOEN_DESKTOP_URL=http://localhost:3000 pnpm dev:desktop

# Connected desktop, with the normal Zoen backend configured and running
pnpm dev
pnpm dev:desktop

# Native development and distributable build checks
pnpm dev:mobile
pnpm --filter @zoen/mobile ios
pnpm --filter @zoen/mobile android
pnpm package:desktop
```

For shared-component development, run `pnpm --filter @zoen/companion-ui dev` alongside the host. Mobile exports are JavaScript bundle checks, not signed native application builds. CI builds unsigned desktop packages on macOS, Windows, and Linux without publishing. Desktop release builds need signing, notarization, update infrastructure, and a deployed `/companion` route before distribution. No deployment is performed by this change.

## Scale target: one million accounts

A million accounts is a product target, not a concurrency estimate. Size infrastructure from measured active users, peak concurrent runs, event retention, browser minutes, attachment volume, and provider limits. The following are release requirements, not performance claims:

1. Enforce account/workspace authorization on every read, stream, and command. Exercise cross-account and revoked-access attempts in integration tests.
2. Keep API instances horizontally replaceable. Eve/Postgres owns durable execution; client navigation or process termination must not lose an accepted turn or replay an external write.
3. Use bounded/keyset queries and virtualized client histories. Separate run admission, queued work, and execution capacity. Cap expensive browser/model work per account and per provider, with backpressure and fair scheduling.
4. Store artifacts in object storage, deliver through scoped grants, and define quotas and retention. Do not place file contents or unbounded event logs in the application process.
5. Instrument queue wait, time to first event, turn failures, reconnects, tool latency, database saturation, and cost per completed task. Test cancellation, worker restarts, network loss, and provider throttling with realistic concurrency.
6. Release through staged cohorts with rollback, signed binaries, and native crash reporting. A device capability must be individually granted, scoped, revocable, and attributable to the user’s request.

Existing ownership, approval, workflow, and idempotency tests remain part of the root verification. Infrastructure is not split into speculative microservices solely to look scalable.

## Acceptance sequence toward complete parity

| Stage                     | Work still required                                                                                                                                                 | Acceptance evidence                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Identity and conversation | System-browser desktop sign-in; device verification of Expo OAuth and streaming; attachments; complete multilingual UI; account switching; live subagent inspection | Same account and conversation on desktop/mobile, offline reconnect, approval and cancellation, no access across accounts |
| Muse surfaces             | Finish reference parity: exact typeface/assets, library previews and selection, personalized ideas/feed, complete settings and existing workspace functions         | Reference-screen comparison and working end-to-end flows, including empty/error states and keyboard navigation           |
| Personal agent            | Complete memory controls, proactive feed, recurring goals, files/artifact creation, connector and message-channel parity                                            | Explicit feature matrix, provider contract tests, durable restart and deduplication evidence                             |
| Device capabilities       | Mac accessibility/screen capture, approved filesystem access, dictation/voice, notifications, device pairing, equivalent Windows/Linux adapters                     | Per-capability permission/revocation tests; visible real native actions on each supported OS                             |
| Media and services        | Image/audio/video/document generation, remaining Muse connectors, wallet/secure-storage behaviors                                                                   | Working provider integrations and user-visible permissions; no placeholder success states                                |
| Distribution and scale    | Signed releases, updates, crash telemetry, recovery drills, representative load tests                                                                               | OS build matrix, upgrade/rollback videos, measured capacity and latency reports                                          |

Every PR must include image and video evidence uploaded with `gh --attach`. Use synthetic accounts and data. Mark preview-only behavior and unverified platforms explicitly. Full Muse parity is complete only when the entire feature matrix is implemented and verified, not when every navigation icon exists.

## Connected-client verification and release limits

The local browser review uses a synthetic account on an isolated PostgreSQL database. The verified flow creates a conversation through the real model, saves a reading goal and a workspace document through agent tools, reloads the conversation, completes the goal, and edits the document in the library. No Muse account content is included in public evidence.

Conversation creation submits its first message through Eve to establish ownership, retains the accepted session on a title-write retry, and navigates after the conversation record is saved. Existing conversations share the same bounded history, streaming, approval, cancellation and error behavior across web and mobile. The goal surface uses the existing workstream capacity of 100 records per memory scope; saving a goal does not silently enable a schedule.

Better Auth and its Expo/OAuth adapters use 1.7.6. Upstream removed the temporary 1.7.0–1.7.2 `account.issuer` requirement; migration 0056 replaces that obsolete uniqueness rule with `(providerId, accountId)` without deleting accounts. Google connection queries and fixtures follow the new owning schema. A conflicting provider/account pair causes the migration to fail instead of merging identities. References: [upgrade guide](https://better-auth.com/docs/guides/1-7-upgrade-guide) and [account schema change](https://better-auth.com/blog/1-7-account-schema). Apply the migration as part of the authentication upgrade, before serving the new runtime.

`pnpm preview:companion` starts the connected Next host. Open `/companion`; the standalone Expo web preview does not provide Zoen’s backend. For native devices, set `EXPO_PUBLIC_API_URL` to the deployed HTTPS origin (or a reachable development origin in a development build). No API secrets belong in Expo public variables.

Release remains blocked on signed desktop/mobile distribution, real-device OAuth verification, desktop browser-to-app sign-in, full voice/attachment/device adapters, the remaining feature matrix and measured capacity. The one-million-account target has not been load-tested. Keep this route opt-in until those gates are satisfied.

## Agent panel verification — 2026-09-27

The shared panel uses the existing authenticated transport, TanStack Query and Eve session controller. The web adapter uses the existing Base UI dialog primitives for focus and portal lifecycle; native uses React Native Modal. Metro resolves the shared query package to the mobile host's singleton so both platforms use the same query context. Desktop presents a right panel and compact layouts present a bottom sheet.

The synthetic browser review verified memory creation through an actual agent turn, direct correction, unsaved-change confirmation, two-tab conflict rejection with draft retention, refresh persistence, schedule creation, pause/resume, and bounded conversation activity pagination. The review reminder is left paused. Approval history's empty state was inspected; a new external permission request was not manufactured for the visual review. The isolated runtime tests cover the memory write and schedule authorization boundaries.

The current milestone passed 1,255 unit/component tests in 192 files, the root check/build, and Expo web/iOS/Android exports. These exports validate JavaScript compilation, not real-device sign-in or signed distribution. The isolated runtime suite passed nine tests across workspace identity selection/authorization, memory integration, revocation race and scheduled reminders. Quality review removed duplicate platform controllers and conversation lists; remaining scanner warnings include JSX reachability, intentional platform adapters, component length and recent changes to the active shell. Source-mode editing and discard confirmation are shared rather than duplicated across platform adapters.

## Visual identity documents

The IDENTITY, SOUL and MEMORY cards open a full-screen Markdown editor with bold, italic, headings 1–3, bullet and numbered lists, undo and redo. The about-file description stays outside the saved document. Web and Electron use [Tiptap](https://tiptap.dev/docs/editor/getting-started/install/react) 3.31.3, loaded on demand; Expo web reuses that renderer. Native uses the MIT-licensed [TenTap](https://10play.github.io/10tap-editor/docs/intro) 1.0.1 inside a local WebView with the shared Tiptap Markdown codec. No document content is sent to an editor service.

The common document controller owns dirty state, discard confirmation, save failures and size limits. The existing workspace repository owns membership, role checks, revision comparison and idempotency. Identity selection reads exactly three paths. Changing viewport width keeps an active editor mounted; closing it applies the panel's new layout. Conflicting saves retain the draft and require reopening the latest document. The agent reads the saved files through its existing workspace owner.

Tiptap's Markdown package is version 3.31.3 but its documentation still labels the API beta. Round-trip tests cover headings, nested and ordered lists, marks, links, quotes, code, escaped characters, empty documents and identity-field line breaks. HTML, images, tables and task lists open in source mode to preserve unsupported content. Native also uses source mode for code blocks and horizontal rules, absent from TenTap's bundled editor. Personal notes keep their existing plain-text, one-fact-per-line editor. Library and workspace Markdown editing now reuse the same visual editor. Web exports Markdown and prints to PDF; native uses the system sharing adapter.

Expo 57 constrains react-native-webview to 13.16.1. TenTap's React DOM dependency is overridden to the mobile host's React 19.2.3 renderer; Metro enforces one host React instance, while the bundled editor is isolated inside its WebView. A small pinned TenTap patch releases completed message listeners and bounds unanswered requests to ten seconds, with installed-dependency regression tests for success, timeout and posting failure. Native keyboard, selection and real-device WebView behavior still need device verification; successful bundles alone do not establish those behaviors.

The visual-editor browser review verified the complete toolbar, undo/redo, persisted formatting after save/reopen, two-window stale-write rejection with the original draft retained, recovery to the latest revision, and unsaved-edit preservation across a desktop-to-mobile resize. The actual editor/save/reopen recording uses synthetic data; idle intervals are shortened. Native device keyboard/selection behavior is not inferred from the responsive browser capture.

## Markdown, files, conversations and goal details

All existing Markdown-editing entry points now use the shared visual editor: agent identity cards, the workspace file dialog and the companion library on web, desktop and Expo. The old editor locations were removed. JSON and personal plain-text notes retain their own data formats. Source mode preserves frontmatter and constructs that the visual editor cannot round-trip.

File history previews and restoration update an unsaved draft; saving still uses the current revision and original permission checks. Copy/download use the latest draft. Print excludes application controls and display-only explanatory text. Expo exports through the system share sheet with temporary-file cleanup; filesystem/sharing/clipboard packages follow Expo 57 constraints.

System files now use inline expandable folders, with search revealing matching descendants and sorting preserving parent/child grouping. There are no invented sizes or modification dates. Metadata, pins, trash, rich previews and publication controls remain separate work.

New chat creation now submits its initial message as part of creating the Eve session, so ownership is established before subsequent controls. Text replies carry a bounded quote that survives reload; copy and quote removal preserve the composed draft. The synthetic review's older failed session is retained, not rewritten to conceal its missing historical development snapshot.

Goals open a shared detail sheet with objective, subgoals and a date-grouped activity timeline. Its action sheet offers complete/reopen, rename, confirmed deletion and a conversational Add subgoal flow that stages an editable draft. The existing workstream owner now writes each revision in the same transaction as the goal change. History uses revision-key pagination, returns at most 20 entries per page and is erased by the existing forget operation. Migration 0057 adds history without fabricating past revisions or rewriting applied migrations. A goal may have one level of subgoals; self-parenting, missing or foreign parents, deeper nesting and reparenting a root with children are rejected. Forgetting a parent erases its children and their history atomically. Generated briefings remain open parity work.

The reference inventory now includes Muse's bundled product guides and the supplied backup structure; see [system-file findings](system-files-reference.md). Private archive contents and Muse-owned assets were not imported. These changes are a tested implementation checkpoint, not a claim of complete parity or production capacity.

The latest checkpoint passed `pnpm check` with 1,269 tests in 195 files, `pnpm build`, and Expo web/iOS/Android exports. Seven isolated runtime tests cover workspace repositories and schedule history; goal tests additionally cover revision pagination, stale mutations, hierarchy and family erasure. A real model turn saved a goal and its subgoal, which appeared in the shared UI with actual progress. Browser review verified the new action sheet, rename persistence and Add subgoal drafting. The current editor/goal video is slowed threefold for review. Responsive mobile captures are not native-device verification.

## Goal list and creation flows

Goal display preferences are stored per workspace member, with membership-cascading deletion. Each mutation updates just one option so simultaneous changes from different devices cannot revert the other option. The shared schema is exported through the UI package’s lightweight `./goals` contract; database services import no renderer. Migration 0058 adds these preferences without rewriting existing records.

The main list separates ongoing tracking from outcome-oriented goals and preserves one level of subgoals. Completed items move to a separate sheet and can be reopened. Categories first explain the conversational setup, then prepare an unsent draft. Automatic sorting uses recent activity; disabling it orders titles alphabetically. Muse’s exact ranking algorithm remains unverified. The shared package keeps its existing ES2022 target, so title ordering sorts an owned array copy rather than requiring ES2023 APIs.

Responsive web pages now use their own headings; the stacked avatar remains in web chat and on native compact screens. A real model saved a tracking record without scheduling work. Browser verification covered persisted subtitles after reload, changed sort order, category-to-draft navigation and complete/reopen through the completed list. The latest root check passed 1,272 tests in 195 files, the production build and Expo web/iOS/Android exports. Signed native and real-device validation remain separate release gates.

If saving a newly accepted conversation’s title fails, retry keeps the original title/message and carries any revised text into the opened conversation as an unsent draft. It neither discards that text nor silently sends a second turn. A focused recovery test protects this behavior.

### Personal Ideas and delivered messages

Personal proposals are stored under `(workspaceId, userId, key)`, with bounded keyset reads and a membership foreign key. Topic keys are immutable: a model retry cannot revive a dismissed suggestion or replace a task already accepted. Positive feedback is not execution authorization. The existing durable-delivery receipt mechanism starts the user-approved task once; the same endpoint can recover an interrupted handoff. Runtime events own progress, ordered by timestamp and event ID. A completed response is not proof that a real-world goal is complete.

The agent can list prior ideas and feedback and save grounded proposals. The shared Ideas screen exposes detail, start, positive feedback and dismissal on web, Electron and Expo. Generation is conversational for now; Muse’s automatic loop, expiry, ranking and curated catalog remain release work.

Message-delivery and reaction contracts now live in `@zoen/companion-ui/messages`. Both conversation interfaces reuse the same successful-receipt projection. The shared client shows delivered answers and attachments, keeps approval controls, and suppresses internal completion markers and routine tool receipts. Copy/reply operate on the delivered text. The former schema locations were removed and every caller migrated.

## Editorial Feed and personal instructions

Private posts and instructions are keyed by workspace and user, with membership cascade deletion. Posts are immutable by publication key; repeated delivery returns the same receipt and cannot revive deleted content. Reactions are explicit set operations. Reads use a 20+1 keyset page with timestamp/UUID tie breaking. The agent reads the personal brief and recent reactions before creating posts and retrieves the exact original for discussion. Editing instructions grants no new schedule or external-action permission.

Feed instructions reuse the visual Markdown editor with stale-write checks and retained error drafts. Discuss uses the existing persisted quotation contract; the composer shows the post title separately from the user's question. Browser handoffs keep text in tab-local storage and put only an opaque reference in navigation. The old scheduled-result-only Feed component, schema and duplicate platform adapters were removed.

Migrations 0061 and 0062 were applied only to the local review database and isolated runtime test database. Real PostgreSQL checks cover concurrent deduplication, private reads/reactions/deletion, immutable retries, deletion replay, membership revocation and instruction conflicts. Automatic editorial generation, media viewers and retention/export policies remain production work.

The Feed checkpoint passed `pnpm check` (1,288 tests in 199 files), `pnpm build`, Expo web/iOS/Android exports and three isolated PostgreSQL tests. A real discussion invoked `feed_read` before answering; the original quotation, human-readable conversation title and response survived reload. Evidence uses synthetic local data. Final verification ran in a managed worktree outside iCloud after cloud eviction interrupted reads in the original checkout.

## Attachment transport and verification limits

The shared composer uses `expo-document-picker` 57.0.2, matching Expo 57.0.25's bundled module manifest; web and Electron use their native file chooser. `expo-file-system` and `expo-sharing` were already installed and are reused for private temporary copies and save/share actions, including Markdown export. See [Expo DocumentPicker](https://docs.expo.dev/versions/latest/sdk/document-picker/).

Inline attachment input is bounded to four files / 3 MiB decoded in the client. Eve's two message POST routes authenticate and read at most 4,400,000 bytes with a 30-second deadline before invoking the native handler. This accommodates base64 overhead within the [hosted request limit](https://vercel.com/docs/functions/limitations#request-body-size). Rebuilt requests preserve public URL, headers and abort signal instead of cloning the runtime's request facade. Large-file private object storage and provider format conversion remain release work. No new database migration or production operation is required for this slice.

The real browser text regression verified creation, a subsequent turn and retained drafts after rejection. Full attachment upload/model/reload and native-device tests remain pending. The original text/file composition helper was removed from the web route; the shared SDK-shaped draft is now the single owner for both chat surfaces.

Attachment checkpoint validation: `pnpm check` passed 1,313 tests across 201 files, lint, types, formatting, unused-code checks and desktop compilation. `pnpm build` passed; Expo exported web, iOS and Android. The browser text conversation survived reload. The structural quality delta is not clean (24 gating findings, dominated by churn plus Composer/MessagePart complexity/size); it is not evidence of release readiness.

## Persistent message reactions

Conversation reactions use the existing Eve session ownership boundary, with one row per session/message. Migration 0063 cascades annotations when the session or its owning membership is removed. A write locks the owned session before setting or deleting the emoji; repeating a value is idempotent. Reads join the ownership record, accept at most fifty requested IDs and never scan the complete conversation. The client requests the visible window and keys its short-lived cache by account, workspace and session. It cancels stale reads after a successful write.

The menu reuses copy/reply and adds six quick reactions plus eight emoji categories. [unicode-emoji-json](https://github.com/muan/unicode-emoji-json) 0.9.0 supplies licensed Unicode data. The expanded catalog loads on demand, rendering one category through a virtualized grid with columns sized to the available width. Errors retain the menu for retry. Reactions annotate the UI; they do not authorize a new model turn or external action.

Browser verification covered persistence, replacement, removal, reload, copy/reply and failed-save recovery in synthetic conversations, with 320- and 390-pixel layouts. The shared implementation is available to web, Electron and Expo; signed builds and physical-device verification remain release gates. These changes do not establish full Muse parity, production load capacity or complete account exports.

Reaction checkpoint validation: `pnpm check` passed 1,314 tests in 202 files; `pnpm build`, Expo exports for web/iOS/Android, migration-chain validation and three isolated PostgreSQL tests passed. The structural quality delta still has 10 gating findings (including JSX size/churn and SQL-shape duplication across distinct owners); this checkpoint is not a clean structural-quality or production-readiness claim.
