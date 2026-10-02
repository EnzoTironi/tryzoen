# Bounded semantic execution

This image runs only the published-snapshot compiler/executor. Eve retains durable
orchestration and tool results; authoritative definitions and facts remain in the
workspace file repository. No application database, mounted user files, Docker
socket or provider credentials belong in this image.

The app requires `ZOEN_SEMANTIC_URLS` (one or two comma-separated HTTPS origins,
or loopback HTTP in local development) and `ZOEN_SEMANTIC_TOKEN` (32–128 URL-safe
characters). Every executor receives the same token. Requests are authenticated
before admission, redirects are rejected, and errors contain no SQL/source text.
Unconfigured execution fails closed; ordinary chat does not start an executor.

Each executor admits one disposable Node worker. Startup requires Linux cgroup
v2, a finite `memory.max` at most 1610612736 bytes and `memory.swap.max=0`.
Compose reserves a 1536 MiB maximum per capsule, one CPU, 64 processes, a read-only
filesystem, no capabilities and no new privileges. Two configured capsules cap
active execution at two calculations and 3 GiB total. Reserve this separately
from Eve, PostgreSQL and other services. V8 heap limits alone do not bound WASM
or native memory. No host cgroup/security configuration is changed.

Build with Node 24 and the pinned lockfile:

```sh
pnpm --filter @zoen/companion-ui build:ui
pnpm build:semantic
docker build -f infrastructure/semantic/Dockerfile -t zoen-semantic .
```

The image copies only `.output/server/semantic`. Build generates a credential-free
empty PGlite database template with bounded PostgreSQL buffer settings. Every
worker restores its own copy and loads validated sources with parameterized
200-row chunks. The image contains the compiler, WASM/data assets and template;
it has no runtime package-install dependency or application environment.

Local qualification uses the existing isolated runtime project:

```sh
pnpm test:runtime:setup
pnpm test:runtime -- tests/runtime/semantic-executor.integration.ts tests/runtime/workspace-semantic.integration.ts tests/runtime/eve-semantic.integration.ts
```

Setup is idempotent and retains existing synthetic volumes; reset is a distinct
explicit command. Do not run shared Eve fixtures concurrently. The memory suite
inspects only its named synthetic capsules and confirms kernel OOM containment,
parent survival and successful admission recovery. The known cold query required
1160409088 bytes peak, so a 768 MiB cap was insufficient. Under the measured
1536 MiB cap, a computed 1 GB value triggered OOM after about 6.1 seconds while
the application survived and the next total was 30. Deadline enforcement remains
independent at 15 seconds.

This is an execution and resource boundary for bounded published CSV snapshots.
It is not a general code sandbox, fleet-capacity proof, live connector federation,
TextQL's proprietary runtime or a Boat integration. Production placement,
capacity/cost monitoring and deployment require their own qualification.
