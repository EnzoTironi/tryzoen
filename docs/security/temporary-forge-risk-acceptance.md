# Temporary prelaunch node-forge risk acceptance

This temporary prelaunch policy covers only GHSA-86w9-cpqp-85rv. The
vulnerability remains unfixed, other findings stay blocking, and the policy
grants no deployment authority.
The acceptance ends at **2026-10-04T02:59:00Z**, October 3 at 23:59 in
America/Sao_Paulo, or earlier if deployment, distribution or signing configuration
changes. Do not extend the policy without a new explicit decision.

The affected version is node-forge 1.4.0 through Expo CLI 57.0.27, directly and
through @expo/code-signing-certificates 0.0.6. The root lock and exact current audit
path set are pinned. The wrapper runs the real official-registry audit at the
existing low threshold, prints its raw JSON unchanged, and emits an
"accepted temporary risk" warning and CI summary. It fails closed on other
blocking advisories, changed versions or paths, process/transport errors,
malformed reports, expiration or changed configuration. Infrastructure keeps its
existing unfiltered low-threshold audit.

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
expires. The exception authorizes no deploy, distribution, workflow disablement,
or additional advisory exception.

The pure regression fixture is the public JSON captured read-only from
https://registry.npmjs.org with pnpm 11.24.0 on 2026-10-02 at source
6f8f07079a7748d4081b3e214b4e741a73d4db0b. The live root audit exited 1 with
one high finding; the isolated infrastructure audit exited 0 with zero findings.
Run `node --test scripts/audit/regressions.mjs` for pure regressions and
`node scripts/audit/run.mjs` for the current registry audit. A successful check
using acceptance still contains this vulnerability.

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
