# eve Agent App

This project uses the eve framework: an agent is a directory of files under `agent/`, and eve compiles and runs it.

For a content-only change to the root agent's identity, purpose, tone, or response guidelines, edit its existing authored instructions. Fresh projects use `agent/instructions.md`; a project may instead use `agent/instructions.ts` or files under `agent/instructions/`. You do not need to read the framework docs for a content-only instructions change. A fresh project already has its selected model in `agent/agent.ts`; preserve that file unless the user asks to change the model.

## Read the docs before writing code

```sh
ls node_modules/eve/docs
```

Start with `docs/README.md`: it maps each task to the page that covers it. Read that page before authoring tools, connections, channels, skills, subagents, schedules, or deployment. In a workspace or local package install, resolve the installed `eve` package location first. If the package docs are missing, use https://eve.dev/docs.

Use a bounded authoring loop:

1. Read the relevant page and inspect only files you will modify or need to imitate.
2. Stop discovery once the file location, imports, and definition shape are clear. Implement the smallest complete behavior the user requested.
3. Run one narrow verification. Expand investigation only when it fails or the request needs project-specific details.

Follow links or inspect public types only when the routed page leaves the task unanswered. Do not recursively glob `node_modules`, enumerate the entire docs tree, or read unrelated scaffold files when the direct path is known. Package-manager links can hide files from recursive glob tools even though direct reads work.

## Prefer an existing integration

For recipe, routine, or integration discovery work, first read
[`docs/recipe-integrations/README.md`](docs/recipe-integrations/README.md). It records
the agreed conversational recipe experience, public source catalogs and reuse
constraints. Catalog entries are research evidence, not implemented capabilities
or permission to install, activate, or redistribute vendor code.

When a task names an external product or service, search the registry before implementing its integration. For a generic capability, author a tool instead.

```sh
eve registry search <query> --json
eve registry view <item>
```

Prefer items whose `implementation` is `native`; use Chat SDK adapters when no native channel fits. `registry view` links the item's documentation.

Install without driving interactive prompts:

```sh
eve add <item> --non-interactive
```

Exit code 0 means setup completed, 1 failed, and 2 needs an answer or a prerequisite. On exit 2, run the `next.command` from the final NDJSON event. For a non-secret question, replace its `<JSON value>` answer placeholder with the answer you collected; string values need JSON quotes. Never pass a secret in `--answer`. See `docs/install-integrations.mdx` for setup prerequisites.

## Use eve for Vercel operations

Use eve to link and deploy Vercel projects:

```sh
eve link --non-interactive --project <name-or-id> [--team <team-id-or-slug>]
eve deploy --non-interactive --yes [--project <name-or-id>]
```

A setup may report `eve link` as a prerequisite; run it, then retry the continuation. When a completed setup event has `deploymentRequired: true`, run the `next` command it reports.

## Validate the change

Run the validation the task requests. When it does not establish the behavior you changed, run the narrowest relevant check.

## Repository contract

- The repository root owns the single Next.js application, Eve agent, and shared UI contract.
- The workspace manager lives on `/` and the agent chat on `/chat`. Eve owns tools, connections, skill discovery, approvals and durable execution. Keep product functions direct and colocated with their concrete owner.
- Browser execution belongs only to the declared browser-agent's native tools. Keep each browser tool's schema and implementation together; share the Kernel SDK client through `agent/subagents/browser-agent/lib/kernel.ts`. The coordinator delegates browser work to that agent.
- `agent/subagents/browser-agent/lib` is for code genuinely shared by worker tools. Group a shared worker domain in a lower-case folder, such as `trace/domains.ts` or `autofill/provider.ts`; do not use it as a holding area for a tool's one-off logic.
- Validate runtime environment variables through `shared/environment/env.ts`. `KERNEL_API_KEY` is optional for application startup and required when browser execution is invoked.
- Run `pnpm check` and `pnpm build` before handing off changes.

## Code organization

- Treat `shared` as a narrow contract boundary, not a default destination for application code. A file belongs there only when at least two of `agent`, `app`, `web`, and `db` consume it; put database access in `db/services`, agent behavior under `agent`, and route or section behavior with its route.
- Do not add a generic `modules` layer. Give code a concrete owner and colocate it there. A route section owns its section components, forms, and local parsing; split it only when the files have distinct responsibilities.
- Prefer one cohesive call-site file for code used once. Do not add production factories, dependency containers, server wrappers, or files solely to make a unit test easier to mock.
- Mock imported modules at their owning or external boundary in tests. Do not export mutable dependency bags, dependency setters, reset hooks, or other test-only seams from production modules; keep production exports limited to application behavior and real domain contracts.
- Use lower-case file and folder names. When several files share a domain prefix, make that prefix a folder and name files for their role, such as `trace/domains.ts` rather than `trace-domains.ts`. Do not introduce camel-case filenames.
- Avoid catch-all names such as `manager`, `store`, `helpers`, or `utils` for feature ownership. Reuse an existing narrowly named boundary or place the code at the concrete owner instead.

## Design system

Before planning or changing product UI:

- Build from the primitives in `web/components/ui` and the semantic `type-*`
  typography utilities defined in `app/styles/brand/typography.css`.
- Preserve the current `components.json` primitive base and local extensions;
  add new primitives with the official shadcn CLI.

## Type ownership

- Keep each TypeScript concept anchored to one source of truth.
- Before adding a `type` or `interface`, search for an existing owning export,
  schema-derived type, model inference, or function/value type that can be
  reused or derived.
- Prefer inference for implementation details and contextual callbacks.
- Add a named type only for a real domain concept, public boundary, validation
  source, or meaningfully reused composition.
- Do not mirror schemas, database rows, router inputs or outputs, SDK payloads,
  library exports, or function results with parallel interfaces.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Application architecture

The user authorized a full Eve-native rebuild on 2026-09-19. Preserve the existing landing page and application design, routes, languages and user-facing capabilities. The active implementation worktree includes the user's uncommitted interface changes from the original checkout.

Use the latest published Eve release, currently 0.63.0, and its public APIs. Use plain TypeScript, async/await and Zod for application behavior. Migrate complete slices and their callers; remove Effect, the application ManagedRuntime and redundant Executor routing as their replacements become operational. Do not create an Effect-compatible shim or a second agent framework.

Keep identity, memberships, session ownership, persistent product records and provider idempotency explicit. Eve owns sessions, turns, tool invocation, approval and workflow orchestration. Integrations belong in native channels, connections, tools, memory slots and extensions. Prefer the existing Drizzle/PostgreSQL owner for application data.

Preserve tests of behavior and authorization. Adapt tests of implementation details to the new owner; do not disable a failing behavior to make the migration pass. Run pnpm check and pnpm build, relevant isolated database tests, and browser verification before delivery. Automated runtime suites and model evaluations must use isolated databases. Explicitly authorized production verification uses ordinary product flows and clearly named synthetic workspaces, without resetting databases or changing unrelated records.

## Deployment and data policy

The prelaunch policy was reviewed on 2026-09-19 when the user authorized the Eve rebuild's production deployment and functional verification. Treat the hosted installation and its records as persistent from this rollout onward. Production deployment is not permission to reset its database, rewrite applied migrations, or delete existing accounts. Production checks may create clearly identified synthetic records through normal product flows; cleanup must be limited to records created for those checks.

Optimize for the smallest coherent design representing the product today. Remove obsolete code, schemas, APIs, configuration aliases and transitional paths directly. Do not add compatibility shims, legacy aliases, dual reads or writes, or data-preserving backfills unless explicitly requested. Internal interfaces are not public compatibility contracts: update callers and tests together.

Development and test data are disposable. Prefer recreating those databases over preserving local data through product complexity. Migration history is a replaceable development baseline, but the checked-in chain and setup workflow must remain coherent. Rewriting an applied migration requires resetting affected development and test databases. Consolidate the baseline only as an explicit coordinated change. Preserve database invariants, transactional safety, migration idempotence and deterministic setup.
