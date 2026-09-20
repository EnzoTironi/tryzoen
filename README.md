<p align="center"><img src="public/marketing/zoen-avatar.webp" width="88" alt="Zoen mascot" /></p>

# Zoen

**Less on your mind. More in your life.**

Zoen is a personal and team assistant built on **Eve 0.63.0**. The same web
app, landing page and English, Spanish and Brazilian Portuguese interface sit
on a single native agent runtime.

**Prelaunch:** there are no production users or production data. Internal
interfaces are changed together with their callers. Development data is
disposable; no compatibility layer or data-preserving transition is required.
Revisit this policy before the first production deployment.

## Product and architecture

- Conversation, files, recipes, schedules, connections, memory, accounts and
  trusted networks retain their existing interface and access boundaries.
- Eve owns sessions, native tools, connections, skills, approvals and durable
  execution. Application behavior uses plain async TypeScript and Zod.
- PostgreSQL and Drizzle own identity, membership, product records, transactional
  writes and provider delivery receipts. Git owns versioned workspace content;
  Mem0 provides optional private learned memory.
- Published customer tools run in a bounded QuickJS sandbox. This sandbox only
  executes customer-authored code; it does not orchestrate the agent.
- Treg is an optional native Eve MCP connection. Connect a workspace's account
  at `https://treg.to/mcp/`; catalog discovery and exact-operation approvals use
  Eve. Its catalog contains thousands of endpoints, not thousands of providers.
- Alchemy remains isolated under `infrastructure/` for the existing Fly/private
  service deployment. Its Effect dependency does not enter the application.

See [architecture](docs/eve/architecture.md), [product direction](docs/product-direction.md)
and [rewrite validation](docs/eve/rebuild.md). External services need their own
credentials and qualification; catalog research is not an activated integration.

## Run and test

Requires **Node 24**, **pnpm 11.24.0**, **FFmpeg** (including `ffprobe`) and Docker
Compose for integration tests.

```sh
pnpm install --frozen-lockfile
pnpm test:runtime:setup
pnpm check --concurrency=1
pnpm test:runtime
pnpm db:check
pnpm eval:list
```

The runtime setup creates isolated PostgreSQL and Matrix services, applies both
application and Workflow migration chains, and sets the application role's
permissions. It is repeatable. `pnpm test:runtime:reset` recreates only this test
project's disposable volumes; `pnpm test:runtime:down` stops its services.

For an interactive installation, configure `.env.local` from `.env.example`,
apply migrations, then use `pnpm dev` or `pnpm build` and `pnpm start`.
[Local setup](docs/local-runtime-setup.md) includes a reproducible synthetic
preview. [Self-hosting](docs/self-host.md) and the
[Alchemy guide](infrastructure/README.md) cover actual deployment configuration.

`pnpm eval:agent` runs model-driven evaluations and requires an isolated app and
provider credentials. `pnpm eval:list` only lists cases. The automated runtime
suite compiles and executes the real Eve runtime with deterministic model fixtures,
including replay, process restart and pending approvals.

## Contribute

Read [CONTRIBUTING.md](CONTRIBUTING.md), [AGENTS.md](AGENTS.md) and
[SECURITY.md](SECURITY.md). Keep credentials and personal conversations out of
tracked files and public reports. See [third-party notices](THIRD_PARTY_NOTICES.md)
for dependency and artwork terms; repository code uses the [MIT license](LICENSE).
