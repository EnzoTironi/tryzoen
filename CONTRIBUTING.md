# Contributing to Zoen

Start with the [README](README.md), relevant [architecture decisions](docs/decisions/),
the [architecture](docs/eve/architecture.md) and
[rewrite validation](docs/eve/rebuild.md). For a substantial
feature, open a proposal explaining the user problem and intended boundary.

## Development

Use the versions pinned by `.node-version` and `package.json`. Install with
`pnpm install --frozen-lockfile`; infrastructure has its own installation and
lockfile. Follow [self-hosting](docs/self-host.md) for local services. Keep secrets
in ignored environment files restricted to their owner. Use synthetic accounts,
messages and documents in tests and screenshots.

Read `AGENTS.md` for repository conventions. Product operations belong to their
owning services as plain async functions with Zod validation. Eve owns sessions,
execution, native tools, connections, skills and approvals. Do not add parallel agent loops or bypass workspace
permissions, provider verification or native approval controls.

## Before opening a pull request

1. Make one coherent change with a clear problem and resulting behavior.
2. Run `pnpm check --concurrency=1`,
   `pnpm db:check`, `pnpm eval:list` and relevant
   build/runtime checks. Run `pnpm test:runtime:setup` before the isolated runtime suite; never
   use production. Listing evals is not a live grade.
3. Cover changed permissions, durable state or failures with regression tests.
   Distinguish fixture results from live-provider evidence.
4. Update docs and all three interface languages when behavior or copy changes.
5. Keep generated traces, credentials, personal content and unrelated formatting
   out of the diff. Preserve dependency pins, provenance and license notices.

Zoen is prelaunch with no production users or data. Update internal callers
atomically and delete obsolete interfaces. Keep the migration chain coherent;
recreate disposable databases if an applied development baseline is rewritten.
Baseline consolidation must be explicit, not incidental feature work.
Dependency changes must pass application and infrastructure audits. Do not
suppress an advisory or weaken an evaluation just to obtain a green check.

Shared-service deployment requires the operator's authorization and documented
release gates. A contributor's local test does not authorize production actions.
Contributions must be yours to submit and compatible with the MIT license. No
separate contributor agreement is currently required. Report security issues
through [SECURITY.md](SECURITY.md).
