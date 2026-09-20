# Local runtime setup

Use Node 24, pnpm 11.24.0 and Docker Compose. Install `ffprobe` (FFmpeg) for audio
preflight tests. Never use production databases or provider secrets in tests.

## Deterministic integration environment

```sh
pnpm install --frozen-lockfile
pnpm test:runtime:setup
pnpm test:runtime
```

The checked-in `tests/runtime/compose.yaml` creates only the
`zoen-runtime-tests` project: PostgreSQL 18 on loopback port 15432 and Synapse on 18008. Images are pinned by digest. `tests/runtime/.env.example` contains synthetic
credentials for this environment. The app role and migration role are distinct.
Synapse uses its own PostgreSQL database and role with C collation; its durable
transaction sequence remains unique across restarts. If upgrading an older
SQLite-backed fixture, run the coordinated reset below once. Both services and
their disposable data must move to the new baseline together.

Setup applies the Drizzle migration chain, installs the public Workflow PostgreSQL
schema and reapplies role permissions. Run setup again to verify idempotence.
Tests are serial by file and require the isolated database name and loopback host.
The compiled Eve fixture cleans its own workflow queues to avoid abandoned test
sessions affecting later runs. The restore test performs a real database dump and
restore; its independent erasure journal is an in-memory fixture, not a live S3
qualification.

```sh
pnpm test:runtime:reset  # delete this project's disposable volumes and recreate
pnpm test:runtime:down   # stop this project, keeping its volumes
```

Neither command manages other local containers. Clear inherited database/provider
environment variables when using the synthetic fixture; conflicting database
settings are rejected by the integration test safety guard.

## Preview with synthetic configuration

After setup, load the fixture in a shell and build:

```sh
set -a
source tests/runtime/.env.example
set +a
NODE_ENV=production pnpm build
pnpm start --port 3000
```

Open `http://localhost:3000/`. These synthetic credentials do not enable
model access, external messenger delivery or real sign-in confirmation. Browser
verification uses disposable Better Auth accounts from the runtime fixture.
For development in the same shell, stop the built server and use
`NODE_ENV=development pnpm dev`. Next loads `.env.local` itself when present; do
not forward Node's `--env-file` argument into Next's development process.

## Interactive installation

Copy `.env.example` to `.env.local`, restrict it to its owner and configure your
own database URLs, independent authentication/encryption keys and chosen model
provider. Read [self-hosting](self-host.md) for optional services and webhooks.

```sh
cp .env.example .env.local
chmod 600 .env.local
# Fill the values before running these commands.
pnpm db:migrate
pnpm workflow:migrate
pnpm build
pnpm start --port 3000
```

Use the dedicated migration role for schema setup. `WORKFLOW_POSTGRES_URL` selects
the Workflow database; otherwise it defaults to the application URL. Workflow
setup needs schema privileges, so run it with the migration URL, then restore the
app role for serving traffic. The isolated setup script does this automatically.

The launcher waits for Eve at `127.0.0.1:4274` before starting Next on port 3000.
It owns both children and stops them together. To change Eve's port, set
`EVE_NEXT_PRODUCTION_PORT` at build and use the same value at startup. The launcher
checks Next's compiled route manifest and rejects mismatches. Use
`--hostname 0.0.0.0` only when intentionally exposing Next behind your TLS proxy.

Signed service callbacks use the installation encryption key and public origin;
browser cookies do not authorize them. Workflow callbacks use the internal Eve
origin. Never publish the internal Workflow service directly.

## Validation

```sh
pnpm check --concurrency=1
pnpm db:check
pnpm eval:list
pnpm test:runtime
pnpm build
pnpm --dir infrastructure install --frozen-lockfile
pnpm --dir infrastructure types:check
pnpm --dir infrastructure test:providers
```

`pnpm check` runs types, lint, formatting, dependency usage and unit tests. Runtime
tests use real PostgreSQL, Matrix and compiled Eve with deterministic model
fixtures. Model-driven evaluations and provider round trips require separate
credentials and do not run as part of these offline proofs.
