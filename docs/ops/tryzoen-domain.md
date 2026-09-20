# tryzoen.com public domain split

One Fly app (`companion-tironi`) serves both public hosts. The operator points
DNS and Fly certificates; this repo owns host-based redirects and canonical URLs.

| Host              | Role                                                                                      |
| ----------------- | ----------------------------------------------------------------------------------------- |
| `tryzoen.com`     | Marketing. Landing is `/`. `/welcome` permanently redirects to `/`.                       |
| `www.tryzoen.com` | Permanent redirect onto the same marketing/app split as the apex.                         |
| `app.tryzoen.com` | Product app: sign-in, workspace, Better Auth, Eve, channel webhooks.                      |
| `zoen.tironi.xyz` | Legacy. `/` and `/welcome` → `https://tryzoen.com/`; other app paths → `app.tryzoen.com`. |

Localhost and `*.fly.dev` stay combined (no host split). Health (`/eve/v1/health`,
`/api/health`), Eve, Matrix (`/_matrix/…`), channel webhooks, and `/internal/…`
are not host-redirected, so Fly checks and in-flight provider URLs keep working
while DNS moves.

## DNS (Cloudflare zone `tryzoen.com`)

Create **DNS-only** (grey cloud) A + AAAA records for `@`, `www`, and `app`
pointing at the same Fly IPs as `zoen.tironi.xyz` / `companion-tironi`. Alchemy
must not manage this zone: `ZOEN_DNS_API_TOKEN` / `ZOEN_CLOUDFLARE_ZONE_ID` stay
on `tironi.xyz` for the legacy hostname.

## Fly certificates

```sh
fly certs add tryzoen.com -a companion-tironi
fly certs add www.tryzoen.com -a companion-tironi
fly certs add app.tryzoen.com -a companion-tironi
```

## Secrets (names unchanged — values move to the app host)

Set these on `companion-tironi` **after** `app.tryzoen.com` resolves and has a
certificate. There are no secret renames.

| Secret                      | Hosted value              | Why                                                                                        |
| --------------------------- | ------------------------- | ------------------------------------------------------------------------------------------ |
| `BETTER_AUTH_URL`           | `https://app.tryzoen.com` | Sessions, Google callback `{BETTER_AUTH_URL}/api/auth/callback/google`, Vaultwarden issuer |
| `COMPANION_PUBLIC_BASE_URL` | `https://app.tryzoen.com` | Telegram / Kapso webhook origin                                                            |

A later Alchemy prod deploy writes the same two values from
`production.appHostname`. It will also retarget channel webhooks from
`https://zoen.tironi.xyz` to `https://app.tryzoen.com`. Do not run that deploy
until the app hostname answers HTTPS.

Also update, outside Fly secrets:

- Google Cloud Console (Companion Better Auth client): add
  `https://app.tryzoen.com/api/auth/callback/google` before flipping
  `BETTER_AUTH_URL`. Keep `https://zoen.tironi.xyz/api/auth/callback/google`
  until a test sign-in on the app host succeeds. Google does not reliably follow
  308s on OAuth redirects.
- Stripe Checkout / Portal / webhook endpoints that currently use `zoen.tironi.xyz`
- Uptime base (optional): `COMPANION_UPTIME_BASE_URL=https://tryzoen.com` after
  the apex is live; the default probe still accepts a 308 from the legacy host
