# Qualification evidence

Status: accepted. Updated 2026-10-02 to remove the unused static qualification
ledger. This decision does not authorize a launch or establish live-provider
qualification.

Builds on [skill discovery](adr-skill-proposals-and-dependencies.md),
[account deletion](adr-account-deletion.md) and the current
[runtime architecture](../eve/architecture.md).

## Decision

Exercise the actual Eve capability catalog and product behavior. Discovery after
publishing a skill must return that skill. A static list of claims and a test
that repeats those claims provide no execution evidence.

Three evidence kinds stay distinct: deterministic contract tests,
PostgreSQL integration, and live journeys with a user, model and provider.
`pnpm eval:list` proves a case is discovered. It does not grade a model.
Launch receipts count unique scenarios separately from executions and keep
`liveDeliveries` at zero for synthetic traces.

Capacity claims require measurements. Missing provider configuration and
insufficient quota are not passes. Observability must redact credentials and
TOTP seeds, and diagnostic reads must enforce workspace access.

## Alternatives rejected

- Treating fixed status rows or synthetic fixture passes as live evidence.
- Keeping a production inventory whose only consumer is its own test.
- A second agent loop or evaluator beside Eve.

## Evidence

`tests/runtime/qualification.integration.ts` checks real capability discovery,
published-skill rediscovery, missing-provider failures, diagnostic redaction and
cross-workspace denial in the isolated runtime installation.
`shared/observability/redaction.test.ts` checks password, cookie and TOTP canaries.
See [local setup](../local-runtime-setup.md) for reproducible commands.
