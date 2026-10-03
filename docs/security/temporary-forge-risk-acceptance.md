# Temporary dependency risk acceptance

On October 3, 2026, the user explicitly approved the bounded proposal for
consolidated PR #192 at `afb218273ac69eb3e631b1318e2254030683f414` after its
source checks, builds and both combined reviews passed. This replaces the
historical node-forge-only scope below. The approved configuration changes open
verified Google registration, disable full content diagnostics, isolate runtime
reports by attempt, add bounded R2 qualification and set semantic image file
ownership. Implementing this decision changes only the audit owner, its
regressions/fixtures, this policy record and the two mandatory audit invocations.

The temporary policy permits these exact reported graph entries:

| Graph          | Package              | Version | Advisory                                                                 | Reported paths |
| -------------- | -------------------- | ------- | ------------------------------------------------------------------------ | -------------- |
| Application    | node-forge           | 1.4.0   | [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv) | 100            |
| Application    | http-cache-semantics | 4.2.0   | [GHSA-ch52-4w7c-c8xp](https://github.com/advisories/GHSA-ch52-4w7c-c8xp) | 2              |
| Application    | braces               | 3.0.3   | [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) | 100            |
| Infrastructure | braces               | 3.0.3   | [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) | 3              |

These vulnerabilities remain unfixed. The fresh official-registry reports have
three high findings in the application and one in infrastructure, with no
published patched versions. Report path counts do not establish absence of other
dependency paths. The node-forge paths include Expo CLI 57.0.27 and
@expo/code-signing-certificates 0.0.6; cache semantics appears through the Electron
build tooling; braces appears through application and infrastructure file/build
tooling. These paths do not prove affected behavior is unreachable.

The acceptance ends at **2026-10-04T02:59:00Z**, October 3 at 23:59 in
America/Sao_Paulo, or earlier if guarded configuration changes. The deadline is
unchanged. Do not extend the policy without a new explicit decision. Integration
and production release remain conditional on every protected check, including
exact-source native launch, isolated production restore and post-deployment
acceptance. This decision permits no force/admin merge, disabled check or
production database reset.

`node scripts/audit/run.mjs` audits the application and
`node scripts/audit/run.mjs --graph infrastructure` audits the separately locked
infrastructure. Both invoke the real official registry at the existing low
threshold, include development/production/optional dependencies, print raw JSON
unchanged and emit an "accepted temporary risk" warning and CI summary. The
version-two policy pins each graph's exact advisory set, package versions and
reported path hashes, and the combined configuration. New or duplicate
advisories, changed versions/paths/severity, available fixes, process/transport
errors, malformed reports, expired acceptance or changed configuration fail
closed. A clean audit applies no exception. Neither graph can borrow the other's
report or lockfile. There is no version-one fallback.

Configuration guard coverage includes workflow files, infrastructure, mobile and
desktop configuration/native files, package manifests and lockfiles, Docker,
Fly, Vercel, Next configuration, and deployment/start scripts. Added file names,
removed files and changed bytes invalidate acceptance. EXPO_, EAS_, CSC_,
WIN_CSC_ and APPLE_ environment variable names, and audit override environment
variables, also invalidate acceptance without logging values.
The guard is deliberately conservative. Configuration changes require review;
do not refresh the fingerprint just to make checks pass.

The current mobile configuration disables updates and has no EAS project ID or
codeSigningCertificate. No current remote signature verification entry has been
established. That does not prove absence of exposure: a full Docker/app image
may still contain forge. The advisory has no published fix; upstream PR1152 is
incomplete and unreleased. This commit does not remediate the vulnerability.
See [the advisory](https://github.com/advisories/GHSA-86w9-cpqp-85rv) and
[upstream PR1152](https://github.com/digitalbazaar/forge/pull/1152).

External Vercel auto-deploy settings remain unverified and must be checked before
main promotion. Checked-in main pushes run checks. Production operations remain
manual, plus Sunday recovery on October 4 at 04:47 UTC, after this acceptance
expires. The earlier node-forge-only exception authorized no deploy,
distribution, workflow disablement or additional advisory exception. The current
specific approval above adds only its named graph entries and conditional release
scope.

The pure regression fixture is the public JSON captured read-only from
https://registry.npmjs.org with pnpm 11.24.0 on 2026-10-02 at source
6f8f07079a7748d4081b3e214b4e741a73d4db0b. The live root audit exited 1 with
one high finding; the isolated infrastructure audit exited 0 with zero findings.
The current pure fixtures are the public application and infrastructure JSON
captured from the same registry on October 3 at source `afb21827`; the historical
one-advisory observation remains below. Run
`node --test scripts/audit/regressions.mjs` for pure regressions and both graph
commands above for current registry audits. Successful checks using acceptance
still contain these vulnerabilities.

## Historical node-forge-only configuration reviews

The following records describe earlier scopes and fingerprints. They do not
extend or broaden the current policy.

On 2026-10-02, independent review of CI sharding commit
`bef0be8efcf5b34a0ba6c025b8e751796dd13aaa` checked all 106 guarded files.
Only `.github/workflows/checks.yml` and `package.json` changed in that set;
the runtime command now routes through `scripts/runtime-tests.ts`. Four isolated
copies of the existing runtime fixture and JSON report transfers add no new
node-forge consumer. Dependency versions and locks, signing settings, and
deployment and distribution commands remain unchanged. The reviewed configuration
fingerprint is `fd686230109caeae94737d9da39a856be98db47f38c31679ffe29e360bea3b59`.
The accepted advisory, versions and dependency paths remain unchanged, and the
acceptance still expires at **2026-10-04T02:59:00Z**.

The 2026-10-02 production rollout review covers the Fly volume correction, the
isolated semantic executor and its authenticated calculation probe, and separate
evaluation authentication input. Dependency versions, locks, Expo updates and
code-signing settings are unchanged. The new executor bundle and deployment code
do not import node-forge or add RSA certificate/signature verification. Public TLS
terminates at Fly; the executor authenticates requests with a generated bearer
token. The full web image still includes the existing Expo dependency path through
`@better-auth/expo`, so this review does not claim that node-forge is absent.
The reviewed configuration fingerprint is `31497f4c2c00c5c278eaf46b7ef6e40f1c455ad8ea38a697e5e4ae89339b5087`. The advisory
remains unfixed, its exact version/path constraints are unchanged, and acceptance
still ends at **2026-10-04T02:59:00Z**.

The deployment workflow reruns both dependency audits immediately before applying
infrastructure, so an earlier CI success cannot carry this exception past expiry.

The 2026-10-02 cleanup review compared all 111 guarded files with `ca60406e`.
Only the root manifest and lock changed: the unused direct `yaml@2.9.1` importer
was removed, and pnpm renamed the `@vercel/connect@2.0.0` peer-context key without
changing its dependency snapshot. The node-forge, Expo CLI and certificate
snapshots and the signing, deployment and distribution configuration are
unchanged. An independent review of the fresh official-registry audit confirmed
the same advisory, version and 100 dependency paths; the infrastructure audit
reported zero findings. The reviewed configuration fingerprint is
`c7c8307728af9f47aeef36a3a28e67f34169172244e981f16d74b37514a68b6e`.
Acceptance still ends at **2026-10-04T02:59:00Z**. The audit wrapper now passes
the pinned lockfile directory through pnpm's supported `--config.lockfile-dir`
option; the previous `--lockfile-dir` option was rejected by pnpm 11.24.0.

The 2026-10-02 schema-cutover review compared `e2e96b5a` with the original
cleanup head `55f1ba8f`. Six guarded files changed: the infrastructure runbook,
hosted definition, migration and web-cutover implementations, and two provider
test files. The changes stop every old web replica after backup and before
schema cleanup, then start and verify the migrated mounted image. Independent
review found no added node-forge import, certificate processing or signature
verification path. Dependency manifests and locks, Expo/signing configuration,
workflows, image construction and Fly TLS termination remain unchanged.

A fresh official-registry report contains the same one high-severity advisory,
node-forge 1.4.0, no published patched version, and the exact 100 pinned paths.
The separate infrastructure audit has zero findings. The reviewed configuration
fingerprint is `44210143e2fc69cd3933d0ea09663adcb19ea9371f1106e60a30efd868585b0c`.
The advisory remains unfixed; its version/path constraints and
**2026-10-04T02:59:00Z** expiry remain unchanged. This review does not grant
deployment authority. Recompute and review the final combined configuration
after other branches are integrated.

After localization merged as `725f04b2`, independent review rechecked the final
combined configuration and regenerated root lockfile. Against that main, the lock
delta removes only the root's unused direct yaml 2.9.1 importer. Mobile, desktop,
signing, workflow, Docker, Next and infrastructure dependency settings remain
unchanged. The six infrastructure changes retain the reviewed migration-cutover
scope. The fresh registry report still contains the same high advisory, affected
version, no patched version and exact 100 paths. The final reviewed fingerprint
is `e416be64fb05f4929d7ffb49a87b78d6de57e881d448c2924b726db50d9605bc`.
The vulnerability remains unfixed, the acceptance expires at the same
**2026-10-04T02:59:00Z**, and deployment requires separate user authorization.

The 2026-10-03 UTC restore review compared the configuration with `3c0710ad`.
Only `infrastructure/postgres/pgbackrest.conf` changed in the guarded set: restores
use eight workers while other commands retain one. Independent review verified
the isolated recovery proof and unchanged encryption, TLS, integrity checks,
network isolation and action bound. Dependencies, node-forge consumers,
certificate handling, signing and distribution settings are unchanged. The fresh
official-registry audit still reports the same unfixed high advisory, version
and exact 100 paths; the infrastructure audit reports zero findings. The reviewed
fingerprint is `11a3c22fad092c8612e99d522625a382833a010c6a065df9f0614ff0d57dd6ee`.
The expiry remains **2026-10-04T02:59:00Z**; this review grants no deployment
authority.
