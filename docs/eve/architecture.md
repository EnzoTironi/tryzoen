# Architecture

Zoen has one application and one agent runtime. The landing page and authenticated
app keep their existing design, routes, languages and product capabilities.

| Owner             | Responsibility                                                                                              |
| ----------------- | ----------------------------------------------------------------------------------------------------------- |
| `app/`, `web/`    | Next.js routes, React interface, translations and browser controls                                          |
| `agent/`          | Eve definitions: instructions, tools, connections, skills, memory, channels, schedules and browser subagent |
| `server/`         | Concrete product operations, current authorization and provider adapters                                    |
| `db/`             | Drizzle schema, queries, transactions and migrations                                                        |
| Git workspace     | Versioned documents, authored instructions, skills and customer tool proposals                              |
| Private Mem0      | Learned facts scoped to a person and workspace                                                              |
| `infrastructure/` | Independently installed Alchemy deployment and private services                                             |

## Runtime and product boundary

Eve 0.63.0 owns turn execution, durable sessions, tool discovery, approvals,
connections and workflow scheduling. Tools are native definitions with their
schemas and behavior. Dynamic definitions resolve the authenticated workspace.
There is no application Effect runtime, compatibility facade, Code Mode router,
Operon process or private Eve/Workflow patch.

Product operations are plain async functions with Zod validation. Drizzle's
transaction context follows async calls; nested transactions use savepoints.
Cancellation is propagated to bounded work and checked before transaction commit.
The application retains provider receipts, authorization and record invariants;
these are product correctness properties, not replacement orchestration.

Git writes compare the current workspace revision and publish atomically.
Published skills enter native Eve discovery. Published customer code executes in
QuickJS with bounded time, memory, calls and declared read-only dependencies. The
vendored sandbox remains only for this customer-code feature. External MCP and
OpenAPI tools retain workspace connection revisions and current authority.

## Integrations and authority

Web sessions, verified messenger identities, Matrix rooms, scheduled work and A2A
requests resolve an explicit principal. Tools recheck membership and grant scope;
a Git branch, document, model instruction or stored credential grants no access.
Personal and team memory stay separate. Approvals bind the actual operation,
arguments and current authorized actor. Unknown external outcomes remain uncertain
instead of being retried under a new identity.

Treg uses public Eve MCP connections. A connected workspace can discover catalog
entries and prices. Calls require native approval and receive a stable idempotency
key derived from the connection revision, session and call. Tokens are retrieved
only after checking the live actor and connection revision. Zoen does not bundle
or redistribute Treg's server, and no advertised endpoint becomes an implemented
or tested capability merely by appearing in its catalog.

Native channel delivery uses one stable session alias. PostgreSQL receipts index
acknowledged inputs by workspace and reject conflicting replays; an advisory lock
serializes the initial handoff for each address. Eve still owns consumption,
checkpoints and the turn queue. Session aliases remain bounded as conversations
grow. Migration `0055_native-delivery-receipts.sql` adds only this receipt index.

Eve remains responsible for durable execution. Application tests compile an agent,
run the actual PostgreSQL-backed runtime, submit concurrent duplicate inputs,
restart the process, and resume a pending approval. Deterministic model fixtures
make these proofs independent of paid providers. This does not establish live
provider delivery or arbitrary infrastructure crash recovery.

## Deployment and data

`pnpm build` compiles Eve and Next. `pnpm start` owns both processes, waits for
Eve health, and stops the sibling on failure. Eve listens on loopback; Next owns
public ingress and explicit channel/callback rewrites. Changing the internal Eve
port requires a matching build and startup configuration.

Alchemy remains a separate infrastructure package, including its Effect dependency.
No app module imports that package. Private Mem0 is stateless outside PostgreSQL;
obsolete local-volume and legacy-memory import paths were removed. Optional private services are configured at
their existing boundaries; absent credentials fail closed.

This product is prelaunch, with no production users or data. Delete obsolete
interfaces and update callers atomically. Development and test databases can be
recreated. The existing checked-in migration chain was retained and verified on
an empty database and repeated setup. No migration baseline was consolidated or
applied migration rewritten in this rebuild. Revisit the data policy before the
first production deployment.

Use [local setup](../local-runtime-setup.md) for the deterministic environment and
[validation](rebuild.md) for evidence and remaining external qualification.
