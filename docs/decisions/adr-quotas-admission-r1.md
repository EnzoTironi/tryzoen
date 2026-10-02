# ADR: usage budgets and admission requirements

- **Status:** Requirements accepted; production enforcement pending.
- **Decision:** Enforce account and installation budgets before expensive work,
  with durable metering, concurrency control and clear refusal states.

## Current behavior

`shared/billing/plans.ts` defines Free, Pro and Org budgets.
`db/services/billing.ts` resolves persisted Stripe entitlements for Account and
billing operations. Current turn/tool dispatch does not enforce those budgets.

The unused quota gates, source-read reservation/settlement module and accounting
ledger were removed because they had no product caller. Their isolated tests did
not establish runtime enforcement. Existing media attachment limits remain owned
by `server/channels/media/policy.ts`; the published CSV executor under
`server/workspaces/semantic` retains its processing bounds.

## Required enforcement

- Resolve the authenticated actor and payer from current account and workspace
  membership. A client-selected subject or an entitlement lookup failure must
  not grant paid usage.
- Reserve usage durably before model, tool or other expensive execution, bound
  to the native operation identity. Replay must not allocate or dispatch twice.
- Settle the original reservation once. Unknown, interrupted or timed-out work
  retains its reservation until reconciled; revocation alone cannot refund it.
- Bound concurrency and usage per actor and installation, including model tokens,
  tools, storage, sandbox time and proactive work. One user must not starve others.
- Preserve accounting across recovery and test concurrency, cancellation,
  revocation and failure behavior through the real dispatch boundary.

## Declared Free budgets

| Scope        | Resource                     | Limit        | Rationale                                        |
| ------------ | ---------------------------- | ------------ | ------------------------------------------------ |
| user         | concurrent turns             | 2            | Fairness; avoids single-user turn storms         |
| user         | daily model tokens           | 500_000      | Bounded LLM spend before operator review         |
| user         | daily tool calls             | 200          | Caps tool loops without blocking normal chats    |
| user         | daily proactive messages     | 24           | ~hourly ceiling; respects notification restraint |
| user         | storage bytes                | 100 MiB      | Memory/artifact growth control                   |
| user         | sandbox active seconds / day | 900 (15 min) | Browser/compute cost bound                       |
| installation | concurrent turns             | 20           | Multi-user headroom under small self-host        |
| installation | daily model tokens           | 5_000_000    | Installation-wide spend ceiling                  |
| installation | active users / day           | 100          | Soft pilot scale before load proof               |

These values come from `shared/billing/plans.ts`. Paid plans declare higher budgets;
the values do not establish enforced account or installation limits.

## Qualification

Billing webhooks establish entitlements, not runtime budget enforcement. Cost,
capacity and fairness claims require measured workloads and operational evidence
from the completed admission path. Keep [consumer billing](../consumer-billing.md)
and [self-hosting](../self-host.md) explicit about that distinction.
