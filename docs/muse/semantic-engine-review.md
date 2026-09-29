# Semantic engine qualification — initial slice

29 September 2026. Two candidates only; no application dependency or production data changed. Official npm releases inspected: `@malloydata/malloy` and `@malloydata/db-postgres` **0.0.434** (MIT), `@wrenai/wren-core-wasm` **0.4.1** (Apache-2.0). Node 24.21.0, local PostgreSQL 18, synthetic schemas/roles in the isolated runtime database on port 15432.

## Finding and next implementation choice

Use **Malloy as the compiler candidate for K1/K2**, preserving its native files. Both engines produced the expected results; direct PostgreSQL execution, inspectable SQL and the existing TypeScript runtime make Malloy the smaller integration for this first server-side journey. This is a scoped engineering choice, not a general performance ranking. Production adoption is gated on the executor boundaries below. Wren remains a useful future candidate for explicit local analysis; it is not loaded by chat. No TQL interpreter is planned.

The fixture has four projects and six expense rows, including an empty project and an expense outside the selected month. Alice owns three projects; Bob owns one. PostgreSQL row-level policies and column grants, not model annotations, enforce the scope. Expected September totals: Alice budget **600**, spent **190**; Bob budget **1000**, spent **1200**. Both engines preserve project budgets under one-to-many joins and return zero spent for the empty project.

Malloy compiled and ran the declared views. Identical arguments produced identical SQL. Changing the date range selected August's **999** expense; invalid dates were rejected. A restricted query could not introduce a raw SQL source, the database denied the private column, and revoking expense access denied the next run of an already prepared query. These are focused synthetic proofs, not product-wide authorization or cache qualification.

Wren WASM ran a structured cube query over authorized PostgreSQL snapshots, with expenses registered as CSV. It returned the same September rows and totals. It does not directly query PostgreSQL in this SDK. Inputs must be authorized before registration and never pooled across principals. Existing snapshots cannot attest to a later permission change; the host must reauthorize future executions and discard revoked caches. No automatic federation, browser worker or Expo compatibility was demonstrated.

## Important compatibility findings

- Malloy runtime `given:` date parameters require its `experimental.givens` compiler flag in this release. This is an explicit compatibility constraint; do not describe this surface as stable without qualification.
- The non-pooled PostgreSQL connector leaks a connection when a query fails: its public `runPostgresQuery` calls `client.end()` only on success. The qualification process remained alive after denied queries. Using its existing `PooledPostgresConnection` released failed queries and exited cleanly. Do not deploy the non-pooled path.
- The connector pins `pg` 8.7.3 while Zoen already uses 8.23.x. Resolve and qualify a mutually compatible current driver before adding it to production. The normal `runSQL` path does not enforce abort signals or a result-byte budget. Use the existing constrained execution boundary or a narrowly qualified adapter; passing an option is not proof of cancellation.
- Wren's first mixed-case relationship model failed case resolution. Lowercase names resolved that issue. Wrapping the to-many aggregate with COALESCE in the model then hit a native planner error; placing COALESCE around the cube aggregate worked. These constraints belong in model validation, not silent output correction.
- Wren package unpacked size reported by npm: **71,470,172 bytes**. It must remain outside the ordinary chat/client startup.

## Observations, not service objectives

One local run, four projects only. Malloy first compile approximately **195 ms**, first query **3.4 ms**, repeated query **1.8 ms**. Wren first WASM initialization approximately **188 ms**, model registration/load **69 ms**, first query **259 ms**, repeat **9 ms**, plus snapshot extraction. These paths perform different work: Malloy queries PostgreSQL again; Wren queries a materialized snapshot. Do not infer a winner, p95 or million-user capacity from these numbers.

End-process RSS observations were approximately **125 MiB** for Malloy and **314 MiB** for Wren. They include runtime, fixtures, allocated/cached memory and, for Wren, the retained binary buffer; they are not per-user or steady-state cost measurements. Concurrent spaces, large inputs, cold start isolation and cache invalidation remain unmeasured.

## Production gate

Before K2 is complete: stable published revision and model validation; principal-bound source credentials/policies; schema and result caches scoped by authorization/revision; source revocation; hard query time/row/byte limits and actual cancellation; no external URL imports; known parameter branches and changed schemas; execution manifests with snapshot/freshness; two independent product users and restart. None of the new SDKs replaces Akita, Eve or Matrix.

Sources: [Malloy](https://github.com/malloydata/malloy), [typed runtime parameters](https://github.com/malloydata/malloy/blob/main/packages/malloy/src/lang/test/givens.spec.ts), [Wren MDL](https://github.com/Canner/WrenAI/blob/main/docs/core/reference/mdl.md), [Wren WASM SDK](https://docs.getwren.ai/oss/sdk/wasm). Findings use the installed npm releases, not an assumption that all branch documentation is released.
