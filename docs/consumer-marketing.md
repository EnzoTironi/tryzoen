# Consumer marketing packaging (C-PACK)

Public Instinct / Companion marketing pages inspired by Poke + Town **structure**
(hero → audience → how it works → trust → pricing → docs), not their assets or
copy.

| Route                         | Purpose                                                               |
| ----------------------------- | --------------------------------------------------------------------- |
| `https://tryzoen.com/`        | Consumer landing (hero, people/orgs/prosumers, trust, pricing teaser) |
| `/welcome`                    | Permanent redirect to `/`                                             |
| `/pricing`                    | Redirects to `/get-started`                                           |
| `/docs`                       | Consumer first-run summary linking to `/get-started`                  |
| `https://app.tryzoen.com`     | Sign-in, workspace, Eve, channel webhooks                             |

Primary conversion CTAs point at `/get-started`. Returning users use
`https://app.tryzoen.com/sign-in`.

## Still open

- Public hosts: `tryzoen.com` (marketing) and `app.tryzoen.com` (product).
  Legacy `zoen.tironi.xyz` permanently redirects. See
  [ops/tryzoen-domain.md](ops/tryzoen-domain.md).
- Design polish: motion, photography, social proof wall, annual billing toggle.
- Real Stripe list prices (placeholders remain until dashboard Price IDs).
- Full docs site beyond the first-run summary (operator docs stay in `docs/`).

Do **not** copy third-party logos, illustrations, or proprietary marketing copy.
