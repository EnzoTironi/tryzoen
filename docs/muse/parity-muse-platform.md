# Muse and universal-platform parity

Planning baseline: 2026-09-28, current shared worktree after the message-history/DM checkpoint. This lane complements the messaging and Akita/creator plans; it does not replace their ownership. No new runtime behavior was implemented in this audit.

## Evidence and status rules

**Implemented** means owning code exists and the checkpoint records relevant checks; it does not qualify every platform. **Partial** means a working subset exists. **Missing** means the required journey has no complete implementation in the inspected owners. **Unverified** means evidence is insufficient; do not substitute assumptions for competitor or platform behavior.

Sources: [reference screen inventory](interface-audit.md), [universal client and release gates](universal-client.md), [later social/editor/card checkpoints](tryzoen-social-matrix-handoff.md), and the concrete code owners below. The Muse inventory distinguishes observed, screenshot reference, reported and unverified behavior. It is not an exhaustive vendor feature guarantee.

Later evidence overrides stale inventory rows: attachment uploads and rich cards have subsequent browser verification; the old docked/resizable agent/conversation overlays were deliberately replaced by responsive sheets/modals. Keep the user's chosen navigation, not a literal copy of a vendor's tab count. Keep Discover outside the mobile bottom bar. Creator forms are transitional and must be replaced by the creator lane's conversational journey.

## Product matrix

| ID   | Journey                                                                  | Status and present behavior                                                                                                  | Remaining acceptance                                                                                                                                                                                                                                                       |
| ---- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MP01 | Ask Zoen to do work, follow progress, approve or cancel, return later    | Partial: Eve conversation stream/history/reconnect/cancellation, tools, approvals and authorization links are connected.     | Accepted work survives worker restart and client loss; reconnect reconciles exactly once; render task summaries, child-agent work, artifacts and failure/recovery without implying completion before durable success.                                                      |
| MP02 | Open profile → Activity or Approvals → inspect work across conversations | Partial: real bounded per-conversation history and approval responses.                                                       | Account/workspace-scoped global timeline, dated grouping, result summaries, expandable decision scopes and links to source messages; denied/revoked membership cannot read historical payloads.                                                                            |
| MP03 | Review upcoming routines and control their permissions                   | Partial: schedules, next run, pause/resume, bounded history and source conversation.                                         | Cadence grouping, failed/missed-run handling, edit/delete lifecycle and actual task-scoped grants. Pausing racing execution has explicit semantics; retries do not duplicate external actions.                                                                             |
| MP04 | Open Feed, understand why an item exists, react/discuss/delete           | Partial: private editorial records, sources, rationale, reactions, deletion replay protection and editable instructions.     | Opt-in proactive generation from authorized context, deduplication, bounded cadence/cost, diverse ranking, safe media viewers, expiry/retention. Discuss preserves the existing draft and source identity.                                                                 |
| MP05 | Receive an Idea, tune recommendations, start a useful task               | Partial: personal proposals, rationale/detail, feedback, categories and deduplicated durable start.                          | Proactive generation, curated starter sources, ranking and expiry. Dismissed suggestions do not return after retries; accepting twice creates one task; missing/revoked sources are explained.                                                                             |
| MP06 | Track an outcome or goal without accidentally scheduling execution       | Implemented core: tracking/outcome groups, descriptions, subgoals, dated activity, rename/complete/reopen/delete.            | End-to-end ongoing progress/briefings and routine association without silent schedule creation; large hierarchies, concurrent revision errors and native detail/action-sheet parity remain qualification work.                                                             |
| MP07 | Browse files/artifacts, edit Markdown visually and share the result      | Partial: workspace file hierarchy, IDENTITY/SOUL/MEMORY visual editing, revision checks, source/copy/download and web print. | Selection/actions and authenticated viewers for PDF/office/media/generated creations; version conflicts and recovery; native share/print/export. Remove any remaining legacy Markdown edit paths only after all callers use the shared owner.                              |
| MP08 | Inspect a browser task or interactive app from a beautiful card          | Partial: tool activities, media/file/link cards exist; browser runtime already has its own owner.                            | Browser live preview/takeover/reconnect/cancel/failure journey in companion; interactive MCP Apps host and scoped message bridge; authenticated artifact actions. A presentational tool card is not an interactive app host.                                               |
| MP09 | Change avatar/name/persona                                               | Partial: revision-checked workspace identity documents; personal profile is a separate concept.                              | Real avatar generation/upload/change lifecycle, unsent setup drafts where appropriate, revision conflict and access handling; no copied proprietary Muse asset requirement.                                                                                                |
| MP10 | Connect a provider and control its individual operations                 | Partial: web reuses real ConnectionList, ConnectorLibrary and permission owners.                                             | Complete searched/connected/available/detail/setup/account/scope-upgrade/disconnect states; operation-level Allow/Ask/Deny backed by execution policy. Each advertised integration needs real provider contract evidence.                                                  |
| MP11 | Save a credential/card and approve its use                               | Partial: web SettingsVault reuses saved login/card CRUD and expiring delegation.                                             | Provider wallet onboarding and commerce approval/review/deny lifecycle, masked values and actual scoped credential filling; native UI/adapters. Existing vault CRUD is not Stripe Link/Shop Pay parity.                                                                    |
| MP12 | Manage channels, devices and account settings                            | Partial: web settings connect actual channel inventories and signed-in-session revocation.                                   | Native shared settings families; real device pairing/capabilities, general appearance/account/usage controls, appropriate private support/reporting, complete data export/retention/import policy and product legal destinations. Browser sessions are not paired devices. |
| MP13 | Use the same application comfortably on phone, desktop and web           | Partial: shared UI, responsive overlays, Electron packaging, Expo exports.                                                   | Physical-device OAuth/editor/keyboard/picker/share tests; desktop system-browser authentication; permission-aware platform adapters, signed distribution/update/recovery and native crash diagnostics.                                                                     |

## Important actual-code discrepancies

- `app/companion/settings/index.tsx` routes to real connections, vault, permissions and sessions; these must not be described as wholly missing.
- `app/companion/settings/vault.tsx` uses paginated `api.vault.list`, removal, existing LoginForm/CardForm and VaultDelegation. Add provider journeys at their owning service, not a second vault.
- `app/companion/settings/devices.tsx` correctly identifies its list as signed-in sessions; it is not an OS capability manager.
- `apps/mobile/src/sections.tsx` currently exposes an abbreviated SettingsSection: account, CreatorStudio, a conversational connections/preferences prompt, memory and sign-out. Native settings need substantial implementation, not just visual testing. The creator lane must own removing CreatorStudio; coordinate changes to this shared call-site.
- `packages/companion-ui/src/overlay.tsx` and the latest universal-client rule use the shared 720px responsive boundary. Desktop modal presentation is intentional even when earlier Muse screenshots show a right panel.

## Five implementation slices and parallel ownership

### P1 — Native settings parity and shared presentation

**Owners:** `packages/companion-ui/src/settings.tsx`, `apps/mobile/src/sections.tsx`, `app/companion/settings/{index,connections,permissions,vault,devices}.tsx`. Reuse existing API/service owners; introduce narrow native adapters instead of importing DOM forms into Expo. Coordinate `sections.tsx` with creator work before editing.

Deliver settings index/back navigation and shared loading/error/empty/revoked states first, then existing real connection/vault/session operations. Never expose enabled-looking unsupported capabilities. Browser and device evidence must cover keyboard avoidance, dismissal with dirty state, account switch and membership revocation. Can run alongside P2 and P3 after adapter contracts are agreed.

### P2 — Proactive Feed and Ideas

**Owners:** `agent/tools/{feed,ideas}.ts`, `agent/hooks/ideas.ts`, `agent/channels/ideas.ts`, `db/services/{feed,ideas}.ts`, `packages/companion-ui/src/{feed,ideas}`; reuse existing schedule owners for authorized execution.

Define opt-in, eligibility, source permissions, cadence, deduplication key, expiry and per-account budget before connecting a generator. First ship one real scheduled generation → persisted item → reaction/discuss/start → suppression journey. Isolated database and runtime tests must cover retry, revocation between generation and publication, no source leakage, dismissal replay and cost bounds. Depends on memory lane's authorized retrieval contract, not completion of its dreams system.

### P3 — Global activity and routine control

**Owners:** `app/companion/agent-panel.tsx`, `apps/mobile/src/agent-panel.tsx`, shared agent panel components, `web/trpc/companion.ts`, existing `server/schedules` and Eve public history APIs.

Define bounded global task/approval read contracts and source conversation navigation first. Add dated history/detail, then routine permissions and lifecycle. Do not create a second execution framework or generic event bus. Test interrupted run/reconnect, stable pagination, approval timeout/revocation, canceled/failed run and cross-workspace isolation. Coordinate the profile-panel component with messaging profile work; keep display contracts narrow.

### P4 — Artifact viewer and browser/app cards

**Owners:** `packages/companion-ui/src/library.tsx` and `src/library`, existing shared message-card owner, `app/companion/editing.tsx`, platform file/viewer adapters. Browser execution stays in `agent/subagents/browser-agent`; use its public owner rather than moving browser tools into the coordinator.

First ship authenticated document/media viewer with close/back/download/share, revision-aware visual editing and stable source references. Follow with live browser task controls and a separately scoped MCP Apps host. Depend on messaging/media lane's private object-storage/upload contract. Test expired/revoked grants, unsupported files, oversized payloads, failed previews, sandboxed embedded content and correct focus restoration. Generated media needs a working provider before its action appears as available.

### P5 — Platform qualification and release operations

**Owners:** `apps/desktop`, `apps/mobile` platform adapters/build configuration; existing auth, environment, observability and deployment owners. This lane owns qualification, not broad rewrites of shared screens.

First deliver system-browser desktop authentication and real-device OAuth/reconnect matrix. Then capabilities individually: file/share, notifications, microphone/camera, device pairing and OS control with grants/revocation. Messaging lane owns push semantics and delivery; this lane owns OS registration, entitlement and interaction evidence. Capture macOS/Windows/Linux packages and actual iOS/Android behavior; exports alone cannot pass this gate. Signed distribution, upgrade/rollback, crash reporting and recovery drills precede general availability.

## Cross-cutting native experience acceptance

The following are Zoen acceptance criteria, not claims that the inspected vendor implements every item:

- Sheets on compact layouts and centered modals on desktop; composer reference suggestions remain above the input on both. Fullscreen editors remain fullscreen. Resize preserves drafts, selection and focus.
- Platform system typography and semantic type tokens, clear selected states, consistent spacing/materials, motion that respects reduced-motion preference, legible contrast and non-color-only status.
- VoiceOver/TalkBack and keyboard access: named controls, logical focus, modal containment/return, Escape/back, visible keyboard focus, large-text reflow, usable touch targets and announcements that do not repeat every streaming token.
- One shared visual editing owner; selection, undo, composition/IME, paste, references, formatting and unsent draft restoration tested with the software keyboard as well as desktop keyboard.
- Complete happy/loading/empty/error/denied/revoked/offline states. No navigation item merely says to open the website for an otherwise supported native feature.
- Synthetic visual comparison evidence at compact, tablet and desktop sizes; interactive browser verification before images/video are uploaded using `gh --attach`.

Apple's [Sheets](https://developer.apple.com/design/human-interface-guidelines/sheets), [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility) and [Notifications](https://developer.apple.com/design/human-interface-guidelines/notifications) are the primary design review destinations. The text-only retrieval on this audit returned JavaScript-required pages, so no detailed latest API behavior was inferred from that retrieval. Read relevant platform documentation during each implementation slice.

## Production completion gate

A million accounts is not a concurrency number. Establish a representative workload and measure peak concurrent conversations/runs, background schedules, object volume, retention, provider/browser minutes and queue pressure. Prove authorization, bounded reads, worker restart safety, fair admission/quotas, provider retry/idempotency, latency budgets, crash/reconnect rates, backup restore and rollout rollback. Keep secrets and private source content out of analytics and PR evidence.

Current version pins are recorded in universal-client.md; upgrading Eve requires its workflow-patch/runtime migration, not a package-number edit. Before shipping each slice run required `pnpm check`, `pnpm build`, relevant isolated database/runtime tests and interactive verification. Native export/package success, unit tests, and a polished screenshot each prove different things; none alone constitutes platform or capacity readiness.

## Remaining reference discovery

Still unverified from the Muse audit: onboarding/recovery, active browser takeover, creation publishing, complete office/media viewers, checkout/provider handoff, native permissions/share extensions and notification actions, region/account-gated capabilities. Add discoveries as evidence-linked rows without blocking already-defined Zoen journeys on exhaustive competitor reverse engineering.

## First native settings increment — 2026-09-28

Implemented `Settings → Signed-in sessions` in Expo using the existing Better Auth account/session owner and the existing shared responsive `CompanionSheet`. The panel identifies the current device, shows other app/browser sessions with session-update dates, asks for confirmation before revoking another session and refreshes after success. It refuses current-session/unknown-session removal and rechecks the active account/session before revoking. Loading, signed-out, failed-list and retry states hide cached session details; raw tokens and provider error payloads are not rendered. Fresh-session expiry has a dedicated native Google reauthentication action that keeps the current login active on cancellation or failure. CreatorStudio remains unchanged pending the creator lane's complete replacement.

Files: `apps/mobile/src/settings/sessions.tsx`, its focused tests, the settings call-site in `apps/mobile/src/sections.tsx`, and the explicit `@zoen/companion-ui/sheet` package subpath (keeping React Native ambient types out of the root server-facing export). Eight focused tests passed; shared UI compilation and mobile typecheck passed. The first-wave root integration check/build and Expo web session flows passed (see the roadmap checkpoint). Physical-device interaction is still required. This is signed-in-session management, not paired-device control or completion of native settings parity.

## Voice-message recording increment — 2026-09-28

C3 now has a working recording path in the shared composer used by personal chat, rooms and threads. The microphone sits beside Send. Recording requests permission only after that action, then offers stop, local playback review, discard and explicit attachment. Sending remains a separate existing composer action; text and previous attachments are retained. Disabled/revoked composer state, navigation/unmount, backgrounding and recorder interruption cancel capture. Attachment-limit errors preserve the reviewed recording so the person can recover.

Web and Electron use the browser MediaRecorder API; Expo iOS/Android use the installed `expo-audio` public recorder hook. Expo web uses the browser adapter. Capture is capped at 60 seconds and the remaining existing 3 MiB/four-file allowance; browser audio selects supported WebM/MP4/Ogg and native audio uses M4A/MP4. MIME codec parameters are removed only from the attachment metadata/container MIME declaration to satisfy the existing file schema. Microphones, listeners and temporary native files are released on normal completion and failures. React Native's older AbortSignal polyfill is supported without calling its missing `throwIfAborted` method.

Electron keeps camera and other capabilities denied: only the configured application's main frame can request audio, followed by explicit native confirmation and macOS microphone permission. Packaging includes the microphone usage text and hardened-runtime audio-input entitlement, retaining the JIT entitlement. Expo declares microphone permission while keeping background recording disabled. These packaging changes require rebuilding native binaries.

Evidence: 26 focused browser/native adapter, desktop permission-policy and shared recorder-state tests pass, including late permission grants after cancellation, background/device interruption, size/duration limits, failed encoding, disabled-state cancellation and no implicit attachment. Mobile typecheck, desktop compilation and focused lint passed. Real microphone capture/playback on signed desktop and physical iOS/Android devices remains unverified; no microphone access was granted through review tooling. Transcription, speech understanding and resumable large uploads remain separate work.

Primary implementation references: [MediaRecorder](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder), [Expo Audio](https://docs.expo.dev/versions/latest/sdk/audio/), [Electron session permission handlers](https://www.electronjs.org/docs/latest/api/session), [Electron native media access](https://www.electronjs.org/docs/latest/api/system-preferences), and [Apple audio-input entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.device.audio-input). Installed Expo public types and React Native's `setUpXHR` polyfill owner were also inspected; no additional recording dependency was installed.

## Native credential permissions increment — 2026-09-28

Expo Settings now opens a real credential-access sheet (centered modal on desktop widths), using the existing workspace delegation read/revoke APIs. The list shows labels and expiry without secret material; members have read-only controls. Revocation requires a separate confirmation beside the selected row, rechecks the signed-in account/session and current grant before mutation, and removes the successful grant from cache before refetching. Closing/cancelling does not revoke. Saved credentials remain in the vault.

The inspection service now holds membership/session authorization locks through the metadata read in one database transaction. Native queries are account/session scoped, revalidate on mount and foreground, hide stale metadata during loading or access failures, and remove confirmation after a role change. Native currently uses the personal workspace; a future workspace picker must include its selected workspace in the query scope.

Validation: 16 focused permissions tests plus eight existing session tests passed; four isolated vault-delegation runtime tests passed, including removed-member denial, secret-free metadata and post-revocation absence. Physical-device accessibility and provider/device operation permissions are not claimed. This increment controls existing credential delegations only; native vault CRUD, channel linking and full provider onboarding remain separate gaps.

## Native linked messaging channels increment — 2026-09-28

Expo Settings adds Messaging channels backed by `accountChannels.list` and `accountChannels.revoke`. Telegram and WhatsApp identity metadata uses the canonical shared schema, also consumed by the server and web UI. Account/session-scoped queries revalidate on opening and foreground, and hide cached identity data during loading or authorization errors. Unlinking requires an inline confirmation that explicitly warns about signing out of every Zoen session; keeping the link does not mutate it. `last_access` leaves the identity and current session intact and explains why. Successful revocation clears private query cache and completes local sign-out; a failed local cleanup has a recovery action. The same settings opener now owns session-keyed panel mounting for channels, permissions and sessions.

Focused verification: 15 linked-channel tests, 16 credential-permission tests, eight session tests and 15 shared channel-auth tests passed; focused lint passed. Three isolated account-channel control tests passed, including concurrent unlink and revoked-session denial. The controls retain authorization row locks and acquire the existing channel-account advisory lock first for writes, preserving lock order. This increment manages existing linked identities only. Native channel-link onboarding, provider OAuth, and live Telegram/WhatsApp transport qualification remain separate work. Successful unlink intentionally invalidates sessions, so visual QA must use a separate disposable account.
