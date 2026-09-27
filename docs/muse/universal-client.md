# Zoen’s universal companion

The product target is the complete Muse experience: its interaction model and visual detail, together with real, durable behavior. Zoen remains the product and backend. Electron is the desktop host; Expo is the mobile host. React Native components render through React Native Web on desktop and web.

The client now connects the main Muse-style surfaces to durable Zoen data. It is **not full Muse feature parity**. It must remain an opt-in route until the acceptance work below is complete.

## What runs now

- `/companion` uses the shared welcome screen and composer against Zoen’s existing Eve channel. `/companion/:sessionId` checks account/workspace ownership before loading a conversation.
- Existing conversations reuse Zoen’s paginated history, reconnect, stream, cancellation, and approval handlers. The new view renders Markdown, tool progress, authorization links, approval options, and freeform questions. It does not create another agent runtime.
- The shared shell keeps conversation search, feed, ideas, goals, library and settings inside the companion. Ideas prepare an editable message; goals read saved workstreams and support revision-checked completion; the library opens and edits persisted workspace files. Feed pages show completed scheduled results, with a conversational setup flow when empty. Search and feed use bounded keyset queries.
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

Use [Better Auth’s Electron integration](https://better-auth.com/docs/integrations/electron) for system-browser authentication and [its Expo integration](https://better-auth.com/docs/integrations/expo) for native sign-in and secure session storage. These are evaluated next steps, not capabilities installed by this change.

## Running locally

```sh
pnpm install --frozen-lockfile
pnpm --filter @zoen/companion-ui build:ui

# Shared interface preview, without a database or agent credentials
pnpm preview:companion
ZOEN_DESKTOP_URL=http://localhost:8081 pnpm dev:desktop

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

Conversation creation persists history before submitting a turn, retains the session and draft on retry, and navigates only after the turn is accepted. Existing conversations share the same bounded history, streaming, approval, cancellation and error behavior across web and mobile. The goal surface uses the existing workstream capacity of 100 records per memory scope; saving a goal does not silently enable a schedule.

Better Auth and its Expo/OAuth adapters use 1.7.6. Upstream removed the temporary 1.7.0–1.7.2 `account.issuer` requirement; migration 0056 replaces that obsolete uniqueness rule with `(providerId, accountId)` without deleting accounts. Google connection queries and fixtures follow the new owning schema. A conflicting provider/account pair causes the migration to fail instead of merging identities. References: [upgrade guide](https://better-auth.com/docs/guides/1-7-upgrade-guide) and [account schema change](https://better-auth.com/blog/1-7-account-schema). Apply the migration as part of the authentication upgrade, before serving the new runtime.

`pnpm preview:companion` starts the connected Next host. Open `/companion`; the standalone Expo web preview does not provide Zoen’s backend. For native devices, set `EXPO_PUBLIC_API_URL` to the deployed HTTPS origin (or a reachable development origin in a development build). No API secrets belong in Expo public variables.

Release remains blocked on signed desktop/mobile distribution, real-device OAuth verification, desktop browser-to-app sign-in, full voice/attachment/device adapters, the remaining feature matrix and measured capacity. The one-million-account target has not been load-tested. Keep this route opt-in until those gates are satisfied.
