# Eve rebuild — 2026-09-19

Zoen now uses Eve **0.63.0**, verified against the published npm release during
final validation. The landing page, authenticated routes, Portuguese, English
and Spanish interfaces and the user's seven pending interface edits are preserved.
The landing header now exposes the existing language picker, including on mobile.
It detects the browser language initially and preserves a manual selection for
one year. Portuguese, English and Spanish were checked through the UI and
Accept-Language requests, including explicit selection overriding detection. A
Spanish headline overflow found at 390px was corrected only in the mobile layout;
the original design and messenger CTA destination remain intact.
The original checkout remains untouched. The rebuild was developed in
`../tryzoen-eve`; subsequent production fixes use that same worktree.

## Final design

- Eve owns tools, skills, connections, approvals, sessions, turns and workflows.
  Workspace capabilities and optional Treg MCP connections use native discovery.
- Product operations use async TypeScript, Zod and Drizzle. Application Effect,
  ManagedRuntime, Operon, the extra Executor router and private Eve/Workflow
  patches were removed. Subsequent fixes to the published packages are documented
  in [dependency patches](../../patches/README.md). QuickJS remains only for
  published customer code.
- Identity, current membership, credential scope, transactional writes and
  uncertain provider outcomes remain explicit product invariants.
- Alchemy remains independently installed under `infrastructure/`. Its Effect
  dependency does not enter the app. Mem0 uses PostgreSQL without a local volume
  or legacy data importer.
- The database chain remains intact. Migration `0055_native-delivery-receipts.sql`
  adds scoped native delivery receipts; no applied migration was rewritten and no
  baseline consolidation or compatibility backfill was introduced.
- Obsolete vault payload readers, unused vendor Effect error classes and exports,
  compatibility configuration, launchers and
  architecture documents were removed. Setup, CI and self-hosting instructions
  describe the implemented runtime. The Linux image includes FFmpeg/ffprobe for
  validating inbound audio duration; its binary is checked during the image build.

Treg is an optional, workspace-authorized connection. Its catalog describes
thousands of API endpoints across dozens of providers, not thousands of distinct
services. Catalog reads do not authorize calls: calls require native approval,
current connection authority and a stable idempotency key. Zoen does not bundle
or redistribute Treg's server.

## Verification

Validation uses an isolated, disposable PostgreSQL/Synapse installation and
synthetic product data. Synapse uses its own PostgreSQL database with a durable
transaction sequence; its earlier SQLite fixture reused outbound IDs on restart
and was replaced with a coordinated disposable reset. The deep browser pass also
uses a real model through
Eve’s public ChatGPT provider and the existing local login. No messages were sent
to external people.

| Verification                            | Result                                                                                                                                                                                        |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check --concurrency=1`            | Passed: 173 files, 1,134 tests; TypeScript, lint, format and Knip passed                                                                                                                      |
| `pnpm test:runtime`                     | 240 tests across 62 files covered in aggregate: full 239-test run, corrected Google assertions rerun 3/3, affected Matrix cases 4/4, and new four-control reaction regression 1/1             |
| `pnpm build`                            | Passed: native Eve compilation and Next production build                                                                                                                                      |
| Linux Docker image and startup          | Passed on final Linux/arm64 image: Eve 0.63.0, health ready, landing 200 with Spanish autodetection, unsigned Matrix callback rejected with 403, actual audio validator returned 1.25 seconds |
| Database setup and repeated setup       | Passed from empty PostgreSQL/Synapse volumes and passed again without changes                                                                                                                 |
| `pnpm db:check`                         | Passed, including migration 0055                                                                                                                                                              |
| `pnpm eval:list`                        | Passed on Eve 0.63.0                                                                                                                                                                          |
| Frozen dependency installation          | Passed                                                                                                                                                                                        |
| Application and infrastructure audits   | No known vulnerabilities reported                                                                                                                                                             |
| Infrastructure types and provider tests | Passed, 28 tests                                                                                                                                                                              |
| Private Mem0 adapter                    | Passed, 5 Python tests with real PostgreSQL/pgvector and deterministic model fixtures                                                                                                         |
| Browser                                 | Passed on Eve 0.63.0: landing + 22 authenticated routes, mobile/desktop, pt-BR/en/es and profile save/reload; no browser errors or HTTP 5xx                                                   |

The compiled native fixture proves concurrent cold delivery convergence,
idempotent writes, continuation after process restart, pending approval recovery
and native memory save/remove results reaching the next model step. Receipt tests
also check workspace isolation, divergent replay rejection and deletion cascade.
The full runtime suite exercises real PostgreSQL, actual Synapse, account
revocation races, native workspace tools and backup restoration. Provider/model
responses are deterministic where a paid external service would otherwise be
required.

Memory deletion removes stored notes. The current notes are returned to the model
as the tool result, and Eve supersedes recalled notes at the next turn or
compaction boundary. It does not redact prior conversation history. A disconnected
projection simulator and its old patch-specific tests were replaced with the
compiled native behavior proof.

The original unit baseline included tests for removed compatibility paths and
Effect lint rules. Those implementation tests were removed with their owners;
behavior, authority and concurrency coverage was adapted to the new boundaries.
Test-count differences are not a like-for-like coverage measure.

## Deep functional browser verification

The additional user-oriented pass exercised actual conversations with
`gpt-5.6-luna`, compiled Eve tools, the existing interface, and real local Matrix
rooms. Browser actions were performed through the UI; saved results were checked
in another screen or tab rather than inferred from the assistant’s prose.

- Conversation tools listed files, rejected an unsupported path, saved a Markdown
  document and read its exact content back. A fresh conversation recalled a
  fictitious preference, displayed a native question, and removed the preference
  after the selected response. A separate fresh conversation confirmed that the
  removed preference was no longer recorded.
- Native approval cancellation left the project unchanged. A fresh proposal
  survived a browser reload; approving it changed the independently inspected
  project from `planned` to `active`. Pending input changes reached another open
  tab without reloading it. Earlier replies and timestamps survived another
  reload, and a message after Stop succeeded. The default iMessage-style view
  intentionally shows completed assistant replies instead of streamed drafts.
- The editor retained a draft on a concurrent revision conflict. Editing, saving,
  viewing history, restoring a prior version and downloading its original source
  worked. DOCX and text PDF uploads were converted; a scanned PDF reported the
  need for OCR, and a subsequent supported upload succeeded.
- Workspace and group creation persisted after reload. Team projects, tasks,
  status changes and relationships were saved. Recipe, reminder and conversation
  navigation kept the selected workspace. The profile username and discovery
  setting persisted after reload.
- Group conversations used shared file and ontology tools against the team’s
  data. The final pass created and reread a shared file, checked its exact content
  in the editor, and completed a native group question by replying in the room.
  A clean room then received exactly one heart reaction and no text/error reply;
  the live model reproduced the empty-output failure, and the completed receipt
  retained the matching native session. This was checked after the turn settled.
  Compiled native regressions additionally exercise questions, requester-only
  approvals, cancellation, replay, concurrent approval responses, reactions,
  current membership checks and isolation from personal files and memory.

This pass found and corrected real defects: a dynamic messaging resolver that
could not be serialized by Eve; missing default ontology discovery; missing group
input and native message delivery; retry hashes affected by Synapse’s transient
metadata; stale invite events invalidating membership; lost workspace scope in
navigation; `.md` filename normalization; overlapping entity form field names;
missing reaction display; unavailable optional memory tools; and conversation
stream/history behavior. Approval continuations with blank native turn IDs now
receive stable UI keys derived from the native sequence, without changing durable
events. Settled tool receipts take precedence over stale pending-approval context.
Regression tests cover those behavior boundaries. Waiting for the complete
reaction turn also exposed an empty-model-follow-up error after successful emoji
delivery. The narrow handling applies only to successfully delivered reaction-only
turns with that exact native error; genuine model failures and failed work after
progress messages still report failure, and native failure telemetry is retained.
A native turn that finishes before its dispatch acknowledgment now retains its
exact session binding without reopening its completed receipt. The regression
checks this ordering alongside reaction-only empty output, empty output without
delivery, genuine model failure, and failed work after a progress message.

## Review and qualification limits

`ripwire --quality-delta` was reviewed against `d3a11bae8+dirty`; it does **not**
report a clean quality gate. Most gated findings are short-horizon churn from the
rewrite; it also flags changed control-flow complexity in authentication,
private-channel dispatch, workspace import and the conversation hook. Native discovery creates static
call-graph dead-code false positives. No baseline acknowledgment was added to hide
these findings. The framework boundaries, affected callers, lint, types, dependency
usage and executable behavior were checked directly.

This original local qualification did not deploy to production, invoke real Treg
tools or send external messenger/provider writes. The browser sign-in flow exercised challenge creation, polling
and explicit browser continuation, with provider confirmation simulated locally.
The model itself was live; external channel delivery was exercised against local
Synapse and deterministic provider fixtures. The restore proof uses a real PostgreSQL
dump/restore and an isolated in-memory erasure journal, not a live S3 qualification.
Local tests do not establish every provider integration or production disaster
recovery.

## Production follow-up — 2026-09-20

The user authorized deployment and production verification. The prelaunch data
policy was reviewed before the first cutover; hosted records are now persistent,
and production checks use a dedicated synthetic workspace through normal product
flows. No production reset or applied-migration rewrite is authorized.

The [83ce90 deployment](https://github.com/EnzoTironi/tryzoen/actions/runs/35489901147)
passed its exact-commit checks and native evaluations, encrypted backup recovery,
and service probes. A live conversation wrote and reread a QA file while the
temporary recovery database was running. Service database URLs select the fixed
primary machine; the recovery database accepts loopback connections only.

Production user testing also covered Google sign-in, landing languages, files and
history, document import/export, browser tools, questions, approvals, skills and
group conversations. It exposed Google tool-schema, cancellation, restart and
scheduled-report defects; their focused regressions belong to the corrective
release. These checks do not certify unconfigured external provider integrations.

See [architecture](architecture.md) and [reproducible local setup](../local-runtime-setup.md).
