# Cloudflare R2 qualification

`pnpm qualify:r2` checks an **existing dedicated test bucket** before the roadmap's
payload migration. It never creates a bucket, enables public access, changes a
token, lists objects, or touches PostgreSQL. The four canonical database payloads
remain in their existing owners until the complete migration is ready.

## Prerequisites

R2 must be activated by the account owner. Select the account's default, EU, or
FedRAMP jurisdiction and two existing buckets in that jurisdiction:

- A dedicated private qualification bucket with no customer data.
- A named bucket outside the test S3 credential's scope, used only for a denied
  `HeadBucket` request. The Cloudflare read API must confirm that it exists.

Use an existing secret manager to inject the following references into the command's
environment. Do not put their values in flags, shell history, reports, or PRs.

| Environment reference                 | Permission                                                                                   |
| ------------------------------------- | -------------------------------------------------------------------------------------------- |
| `ZOEN_R2_QUALIFICATION_ACCESS_KEY`    | S3 object read/write for the selected test bucket only                                       |
| `ZOEN_R2_QUALIFICATION_SECRET_KEY`    | Corresponding S3 secret                                                                      |
| `ZOEN_R2_QUALIFICATION_SESSION_TOKEN` | Optional temporary S3 session token                                                          |
| `ZOEN_R2_QUALIFICATION_API_TOKEN`     | Cloudflare read permission for the selected account's R2 bucket metadata and domain settings |

The maintenance environment is validated through the shared environment owner and
requires no application or database credentials. The package command does not load
`.env.local`. `cleanup` requires the S3 references; it does not require the API token.

## Plan, run, and clean up

Quote the actual 32-character account endpoint. These placeholders are not secrets.
Use a fresh absolute output directory under an existing private, canonical parent
path; on macOS use `/private/tmp` instead of its `/tmp` symlink.

```sh
pnpm qualify:r2 plan \
  --endpoint 'https://<account-id>.r2.cloudflarestorage.com' \
  --bucket zoen-payload-qualification \
  --denied-bucket zoen-denied-qualification

pnpm qualify:r2 run \
  --endpoint 'https://<account-id>.r2.cloudflarestorage.com' \
  --bucket zoen-payload-qualification \
  --denied-bucket zoen-denied-qualification \
  --output-dir /private/tmp/zoen-r2-run

pnpm qualify:r2 cleanup \
  --endpoint 'https://<account-id>.r2.cloudflarestorage.com' \
  --bucket zoen-payload-qualification \
  --manifest /private/tmp/zoen-r2-run/manifest.json
```

`plan` needs no credentials and makes no network or filesystem changes. `run` and
`cleanup` print a JSON receipt. Exit zero means the requested command completed;
exit one means invalid input, failed checks, or unresolved cleanup; exit 130 means
interruption. Only a successful
Cloudflare **run** with every required check and completed deletion emits
`providerQualified: true`. A cleanup invocation cannot promote a failed run.

Each run owns three fixed synthetic keys under `qualification/<fresh-uuid>/`.
The directory is mode `0700`; its manifest and exclusive process lock are `0600`.
Before each write, the durable manifest records the exact key intent. Before every
HTTP attempt, it durably reserves its request and PUT-byte budget. Failed and
conditional writes consume that budget too. The SDK has one attempt per call and
does not follow region redirects; HTTP reads refuse redirects.

The hard ceiling is 100 HTTP attempts and 1 MiB cumulative PUT bytes **across the
manifest's run and cleanup invocations**. `--max-requests` can lower the ceiling to
15–100. Nine requests are reserved for exact-key cleanup. Each invocation has a
15-minute deadline; each request, including streaming consumption, has ten seconds.
A lost connection, timeout, interruption, or exhausted limit never establishes a
successful qualification. Cleanup must fit within the remaining persisted budget.

Cleanup performs `HEAD`, verifies the run ID and object name metadata, deletes
only the manifest's known keys, and verifies their absence. It retains unknown,
unreadable, or foreign-owned objects as pending. It never lists a prefix or retries
automatically. Keep the manifest if any key remains pending. The command rejects a
different target, symlinked manifest or run directory, and another active process.
After a hard process kill, inspect the PID in `run.lock` and establish that the
process has stopped before removing that local stale lock and invoking cleanup.
If the persisted budget is exhausted, further provider operations need a separately
authorized cleanup plan; changing the manifest's budget is not qualification.

## What the checks establish

The Cloudflare run checks the managed `r2.dev` and custom-domain public settings
before and after transport tests, proves access to the selected bucket and denial
on the named existing out-of-scope bucket, and verifies anonymous access is denied
on a known object. These observations cover those endpoints and that negative
bucket; they do not inventory Worker proxies, every account bucket, or token policy.

Transport checks exercise conditional `If-None-Match: *` writes, immediate reads,
identical and conflicting write rejection, missing-object handling, bounded stream
consumption, byte length and SHA-256 integrity, and exact-key deletion. One canary
has deliberately wrong digest metadata and must be rejected. Another successful
write's acknowledgement is deliberately discarded before reconciliation by key.
That check models client receipt loss; it is not evidence of a real Cloudflare
network interruption. Qualification does not implement database authority, restore,
erasure, orphan collection, residency acceptance, or the payload cutover.

The selected API and compatibility contracts are documented by Cloudflare:
[S3 compatibility](https://developers.cloudflare.com/r2/api/s3/api/),
[scoped tokens](https://developers.cloudflare.com/r2/api/tokens/),
[managed public domain](https://developers.cloudflare.com/api/resources/r2/subresources/buckets/subresources/domains/subresources/managed/methods/list/),
and [custom domains](https://developers.cloudflare.com/api/resources/r2/subresources/buckets/subresources/domains/subresources/custom/methods/list/).
The S3 public-access-block API is unsupported on R2, so S3 alone cannot establish
the native bucket's public settings.

## Local transport verification

`--local` accepts only numeric loopback HTTP origins and uses fixed synthetic S3
credentials (`zoen-local-qualification` / `zoen-local-qualification-secret`). It
does not read or forward the credential environment. Provision an isolated local
S3 service with those credentials and an existing private `qualification-bucket`.

```sh
pnpm qualify:r2 run --local --endpoint http://127.0.0.1:9000 \
  --bucket qualification-bucket --output-dir /private/tmp/zoen-r2-local-run
```

The CLI tests use the real AWS SDK against a test-owned HTTP server, including an
acknowledgement lost after storing the bytes, temporary cleanup failure, later
exact-key cleanup, changed object ownership, and request-budget exhaustion. Local
results emit `providerQualified: false` even when `localTransportPassed: true`.
They do not satisfy real R2 qualification or production acceptance.
