# Consumer billing (C-BILL)

Hosted Zoen billing uses Stripe Checkout and Customer Portal. Webhooks update
persisted plan and seat entitlements shown in Account. **Free never requires a
card.**

The plan catalog defines usage budgets, but current turn and tool dispatch do
not enforce those budgets. See the [quota requirements](decisions/adr-quotas-admission-r1.md)
and [self-hosting guide](self-host.md) for the remaining operational work.

## Plans

| Plan     | Who                | Placeholder list price               | Declared budgets                                          |
| -------- | ------------------ | ------------------------------------ | --------------------------------------------------------- |
| **Free** | Individuals        | $0 · no card                         | Same floors as Release-1 (`shared/billing/plans.ts`)      |
| **Pro**  | Heavy personal use | **$20 / month** (placeholder)        | Higher personal ceilings                                  |
| **Org**  | Teams / prosumers  | **$30 / seat / month** (placeholder) | Pro-like per seat; installation ceilings scale with seats |

Placeholder prices are documentation only. Chargeable amounts come from Stripe
**Price** objects referenced by env Price IDs.

## Architecture

```
Private conversation offer (target) or Account → Upgrade
        │
        ▼
POST /api/billing/checkout  →  Stripe Checkout (subscription)
        │
        ▼
Stripe webhook  →  POST /api/billing/webhook
        │
        ▼
billing_entitlements row (plan / seats / stripe ids)
        │
        ▼
Account plan and billing controls
```

- Manage / cancel: `POST /api/billing/portal` → Stripe Customer Portal.
- Missing entitlement row ⇒ **Free**.
- No full billing admin console in-app.

## Code map

| Area                         | Path                                                        |
| ---------------------------- | ----------------------------------------------------------- |
| Plan catalog + quota mapping | `shared/billing/plans.ts`                                   |
| Entitlements table           | `db/schema/billing.ts` · migration `0031_consumer-billing`  |
| Read / upsert                | `db/services/billing.ts`                                    |
| Checkout / portal / webhook  | `server/billing/*`                                          |
| HTTP                         | `app/api/billing/{checkout,portal,webhook}`                 |
| UI                           | Account → Plan and billing                                  |
| Organization billing access  | `server/billing/checkout.ts` and `server/billing/portal.ts` |

## Env / Fly secret **names** (never commit values)

| Name                    | Purpose                                                   |
| ----------------------- | --------------------------------------------------------- |
| `STRIPE_SECRET_KEY`     | Server Stripe SDK (`sk_…`)                                |
| `STRIPE_WEBHOOK_SECRET` | Webhook signature (`whsec_…`)                             |
| `STRIPE_PRICE_PRO`      | Stripe Price id for Pro monthly                           |
| `STRIPE_PRICE_ORG_SEAT` | Stripe Price id for Org per-seat monthly                  |
| `BETTER_AUTH_URL`       | Public origin for Checkout success/cancel + Portal return |

Optional: leave all Stripe names unset — Free still works; Checkout/Portal return
503 `stripe_not_configured`. Account billing controls detect missing configuration
and show a disabled state. The public `/pricing` route redirects to `/get-started`.
The authenticated Checkout endpoint is implemented. Automatic offers and Stripe
link delivery in private conversations remain a pending requirement.
Opening Checkout or its return URL never proves payment; the webhook does.

Follow the [infrastructure deployment guide](../infrastructure/README.md#deployment)
for deployment configuration and secret handling.

## Stripe Dashboard setup

1. **Products + Prices**
   - Product “Companion Pro” → recurring monthly Price → copy id → `STRIPE_PRICE_PRO`.
   - Product “Companion Org seat” → recurring monthly Price (per unit) →
     `STRIPE_PRICE_ORG_SEAT`.
2. **Customer Portal** — activate payment method update + cancel subscription
   (Settings → Billing → Customer portal).
3. **Webhook endpoint** — `https://<public-origin>/api/billing/webhook`
   - Events: `checkout.session.completed`, `customer.subscription.created`,
     `customer.subscription.updated`, `customer.subscription.deleted`.
   - Copy signing secret → `STRIPE_WEBHOOK_SECRET`.
4. **API keys** — Secret key → `STRIPE_SECRET_KEY` (test mode first).
5. **Deployment secrets** — set the four Stripe names above plus existing
   `BETTER_AUTH_URL` / `COMPANION_PUBLIC_BASE_URL`. Then `pnpm db:migrate` for
   `billing_entitlements`.

## Acceptance

- New users stay on Free without entering a card.
- Pro Checkout + webhook sets the user entitlement to `pro` with its declared budgets.
- Org Checkout (org admin + `organizationId`) writes org entitlement + seat count.
- Customer Portal opens for an existing Stripe customer.
- Secret **values** never appear in git, PR bodies, or docs.

## Trust copy

- Free never requires a card (see Acceptance).
- Manage / cancel only through Stripe Customer Portal — no in-app card vault UI.
- Privacy export/delete limits for the same Account surface:
  [consumer first-run → Consumer trust](consumer-first-run.md#consumer-trust-c-trust)
  and [self-host §9](self-host.md#9-account-export--delete-limits).

## Out of scope (this slice)

- Durable usage metering and enforcement at turn/tool dispatch.
- Full billing admin console / invoices UI.
- Tax / VAT automation beyond Stripe defaults.
- Merging personal Pro into Org seats automatically.
- Changing Meta / Telegram commercial terms.
