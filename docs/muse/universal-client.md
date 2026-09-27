# Zoen’s universal companion

The product target is the complete Muse experience: its interaction model and visual detail, together with real, durable behavior. Zoen remains the product and backend. Electron is the desktop host; Expo is the mobile host. React Native components render through React Native Web on desktop and web.

This change is the first client foundation, **not full Muse feature parity**. It must remain an opt-in route until the acceptance work below is complete.

## What runs now

- `/companion` uses the shared welcome screen and composer against Zoen’s existing Eve channel. `/companion/:sessionId` checks account/workspace ownership before loading a conversation.
- Existing conversations reuse Zoen’s paginated history, reconnect, stream, cancellation, and approval handlers. The new view renders Markdown, tool progress, authorization links, approval options, and freeform questions. It does not create another agent runtime.
- The shared shell provides the Muse-style navigation rail on wide screens and bottom navigation on narrow screens. Its desktop/web links open Zoen’s existing feature pages; those pages have not yet been ported to the new interface.
- Electron has native menus, a single application instance, and a `Cmd/Ctrl+Shift+Space` show/hide shortcut. Its sandboxed renderer stays on one configured origin. External HTTPS links open in the system browser; files, application protocols, and credential-bearing URLs are rejected.
- Expo runs the same UI components on web and exports iOS/Android bundles. It is explicitly an **interface preview**: mobile account authentication and live agent transport are not implemented here. Preview interactions do not contact the agent.

The desktop renderer currently loads the hosted application. It is not an offline, packaged renderer or an OS automation engine. Google OAuth requires the browser handoff described below; this change does not claim embedded Google login works.

## Ownership

| Owner                            | Responsibility                                                                                                                                       |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/companion-ui`          | Platform-neutral React Native views and interaction state. Public declarations do not expose native renderer types into Next’s DOM type environment. |
| `app/companion`                  | Web authentication, routing, workspace context, and adapters to the existing Eve client.                                                             |
| `apps/desktop`                   | Electron window lifecycle, native menus, validated origin policy, packaging. No general-purpose IPC bridge.                                          |
| `apps/mobile`                    | Expo startup, mobile safe areas, and the current preview. Future mobile authentication and device adapters belong here.                              |
| Existing `agent`, `server`, `db` | Identity, permissions, persistent records, execution, provider integrations, and side-effect idempotency.                                            |

Expo’s Xcode project dependency is constrained to the patched CommonJS-compatible `uuid` 11.1.1 release; its only UUID call is `v4()`. This preserves the existing dependency audit gate.

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

| Stage                     | Work still required                                                                                                                                 | Acceptance evidence                                                                                                      |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Identity and conversation | System-browser desktop sign-in; Expo secure authentication and streaming; attachments; multilingual UI; account switching; live subagent inspection | Same account and conversation on desktop/mobile, offline reconnect, approval and cancellation, no access across accounts |
| Muse surfaces             | Port search, feed, ideas, goals, library, and settings to the shared shell; preserve all existing workspace functions                               | Reference-screen comparison and working end-to-end flows, including empty/error states and keyboard navigation           |
| Personal agent            | Complete memory controls, proactive feed, recurring goals, files/artifact creation, connector and message-channel parity                            | Explicit feature matrix, provider contract tests, durable restart and deduplication evidence                             |
| Device capabilities       | Mac accessibility/screen capture, approved filesystem access, dictation/voice, notifications, device pairing, equivalent Windows/Linux adapters     | Per-capability permission/revocation tests; visible real native actions on each supported OS                             |
| Media and services        | Image/audio/video/document generation, remaining Muse connectors, wallet/secure-storage behaviors                                                   | Working provider integrations and user-visible permissions; no placeholder success states                                |
| Distribution and scale    | Signed releases, updates, crash telemetry, recovery drills, representative load tests                                                               | OS build matrix, upgrade/rollback videos, measured capacity and latency reports                                          |

Every PR must include image and video evidence uploaded with `gh --attach`. Use synthetic accounts and data. Mark preview-only behavior and unverified platforms explicitly. Full Muse parity is complete only when the entire feature matrix is implemented and verified, not when every navigation icon exists.
