# Private Zoen demo

This harness runs the real Next/Eve application with fictional accounts, native
Matrix conversations and repository publications. It uses installed dependencies
and the existing local Codex sign-in. It creates no agent answers and makes no
model calls during setup, build or seeding.

The guarded checkout is
`/Users/enzotironi/Documents/Codex/2026-09-30/task-12/worktrees/demo`.
Private state lives in
`/Users/enzotironi/Documents/Codex/2026-09-30/task-10/demo-state`.
These are intentional machine-local paths; review the guards before moving the
harness to another machine. Keep this checkout and its build outputs separate
from active application development.

## Local topology

| Owner             | Loopback port | State                                                                    |
| ----------------- | ------------- | ------------------------------------------------------------------------ |
| Next application  | 4397          | This checkout's `.next`                                                  |
| Eve runtime       | 9497          | This checkout's `.output`; dedicated Workflow database                   |
| PostgreSQL        | 15439         | Compose project `zoen-investor-demo`, database `companion_investor_demo` |
| Synapse           | 18039         | Same private Compose project; server `zoen-investor-demo.test`           |
| Semantic executor | 18139         | Current compiled service; existing container resource limits             |

Every published port binds `127.0.0.1`. Synapse's local callback targets Eve through
`host.docker.internal:9497`; verify that path on the local Docker runtime. The
launcher accepts a local Unix-socket Docker context, guards database/container
ownership before migrations, and retains project volumes on stop. It never calls
the shared runtime setup/reset commands. Leave the shared database on 15432 and
other developers' applications untouched.

`demoEnvironment()` passes an explicit environment allowlist, known synthetic
installation/service settings and `codex-local/gpt-5.6-luna`. It retains `HOME` for
the existing sign-in and drops inherited provider keys, other database settings
and Node injection options. The worktree guard rejects live `.env*` files.

## Start using existing tools

Use the verified Node 24.21.0 executable directly. No package installation is part
of this workflow. Required pinned PostgreSQL/Synapse images and the official
Node 24.21.0 semantic base must already be cached; `up` fails rather than pulling
missing images automatically. Dependency links must first pass the coordinator's
audit, including indirect `@zoen` aliases and writable output ownership.

The sequence below is initial setup. Stop this demo's app supervisor before a new
build; do not rebuild or run repository checks while recording the live app.

```sh
cd /Users/enzotironi/Documents/Codex/2026-09-30/task-12/worktrees/demo
ZOEN_DEMO_NODE=/Users/enzotironi/.local/share/mise/installs/node/24.21.0/bin/node
"$ZOEN_DEMO_NODE" --import tsx scripts/demo/stack.ts up --dry-run
"$ZOEN_DEMO_NODE" --import tsx scripts/demo/stack.ts prepare
"$ZOEN_DEMO_NODE" --import tsx scripts/demo/stack.ts up
"$ZOEN_DEMO_NODE" --import tsx scripts/demo/stack.ts migrate
"$ZOEN_DEMO_NODE" --import tsx scripts/demo/app.ts build
"$ZOEN_DEMO_NODE" --import tsx scripts/demo/app.ts start
```

`app.ts build` directly runs the installed shared-UI TypeScript compiler, Eve,
semantic compiler and Next build. Eve sandbox prewarm is skipped. `app.ts start`
uses the existing production supervisor for both loopback servers. Its terminal
owns the app; Ctrl-C stops both children.

In a second terminal, supply the approved fictional SVG portraits as
`demo-state/portraits/{maya,imani,theo}.svg`, then run:

```sh
cd /Users/enzotironi/Documents/Codex/2026-09-30/task-12/worktrees/demo
ZOEN_DEMO_NODE=/Users/enzotironi/.local/share/mise/installs/node/24.21.0/bin/node
"$ZOEN_DEMO_NODE" --import tsx scripts/demo/seed.ts --check
"$ZOEN_DEMO_NODE" --import tsx scripts/demo/seed.ts --apply
```

Open `http://127.0.0.1:4397/companion?space=zoen-investor-demo-workspace` with a
fictional account's signed cookie installed privately by the local capture
harness. `seed.json` contains bearer tokens and signed cookies; keep it outside
Git, screenshots, logs, PR attachments and exported deliverables. The state
directory is `0700` and receipts/configuration are `0600`. Sessions expire after 72 hours;
expired or mismatched receipts require explicit local renewal rather than silent
credential rotation. `seed-public.json` omits authentication values.

The seed publishes the four-row launch CSV, its Malloy model/query and two actual
Launch notes revisions through the repository owner. It joins Maya, Imani and
Theo before creating real human DM/group/thread messages and a native reaction.
Stable operation/transaction IDs preserve retry behavior. There are no seeded
agent replies.

## Real agent proof and capture boundary

The authorized maximum is three user-initiated root model turns. This is an
operator-controlled ceiling recorded in the run receipt, not an enforced model
request cap. Keep `gpt-5.6-luna`; do not add a model wrapper, scripted answer or
mock model. No autonomous follow-up, browser execution or subagent delegation is
authorized for this demo.

Plain group history, human DMs, threads and reactions do not invoke the agent.
The native shared bot is Zoen; only an authored `@Zoen` mention resolved into
native mention metadata starts its group delivery. Do not turn seeded history
into published-agent/network conversations, where ordinary sender text can
start an agent task.

Move from group discussion to an authenticated private Zoen conversation with
the fictional team workspace selected for the governed launch-task query. Human
DM history grants Zoen no access to that pair. The existing verified private turn
returned three computed tasks; preserve it rather than spending another turn for
a prettier take. Inspect the real source, revision and result through implemented
controls. If the structured result card remains unavailable, show the actual text
answer and Library files and disclose that limitation. Read both notes revisions
in the actual editor. A group mention or another private turn is optional and
requires a concrete remaining verification need within the three-turn ceiling.

Count admitted root turns and record `turn.started`/terminal events for their
session IDs. Report every distinct `step.started` event separately: tool
continuations and provider retries can make several model requests within one
root turn. Preserve available `step.completed` token usage and cost; unavailable
cost is not zero. Watch for unexpected child/background execution. Stop immediately
on sign-in/quota failure or runaway work, use the authenticated native session
cancel control with `tasks: true`, and confirm `turn.cancelled` followed by
`session.waiting`. Do not restart pending work blindly. The existing model request
deadline is 90 seconds.

## Review and final evidence gates

The local dependency arrangement currently needs an uncommitted Turbopack root
workaround in `next.config.ts` pointing at this Mac's home directory. Keep that
absolute-path change out of the delta PR. Before exporting any build output,
audit every generated `.next/**/*.nft.json` reference and copied server files for
unexpected paths. Reject live `.env*`, Codex/AWS credentials, private demo state
and session receipts; the broad tracing root is not permission to include them.
Repeat the audit after rebuilding. This local workaround is not a portable build
solution.

Final screenshots and films require the approved integrated UI checkpoint, fresh
desktop/mobile visual review and verified real agent/query/source/history flows.
Label current real-app captures as the current actual build with fictional data;
keep consumer fixture captures labelled as staging. Watch actual
recordings and encoded frames for legibility, pacing and playback before delivery.
Do not present a consumer fixture or simulated transport as real backend proof.

Prepare a draft delta PR against `codex/parity-integration` containing only the
demo harness and this runbook. Describe the isolated startup, authentic synthetic
seed and remaining UI/evidence gates. Include the actual validation results and
visually verified evidence using `gh --attach`; exclude private state, dependency
links, build outputs and the machine-local config workaround.

To stop the demo, first stop its app supervisor, then run:

```sh
"$ZOEN_DEMO_NODE" --import tsx scripts/demo/stack.ts stop
```

This stops only `zoen-investor-demo` containers and keeps the fictional data.
