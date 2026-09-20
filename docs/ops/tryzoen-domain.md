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

- Google OAuth — two clients in GCP project `zoen-506921` (checklist below)
- Stripe Checkout / Portal / webhook endpoints that currently use `zoen.tironi.xyz`
- Uptime base (optional): `COMPANION_UPTIME_BASE_URL=https://tryzoen.com` after
  the apex is live; the default probe still accepts a 308 from the legacy host

## Google OAuth — two clients (do not merge them)

GCP project `zoen-506921` already has **two** web OAuth clients. Plow created
**Zoen iMessage** as a separate client and told operators to preserve the other
app's client ([EnzoTironi/Plow `docs/GOOGLE_AUTH.md`](https://github.com/EnzoTironi/Plow/blob/main/docs/GOOGLE_AUTH.md)).
This repo only owns client (2). There is no Cloudflare Worker in tryzoen; do
not add a worker rewrite here.

| #   | Client (Console name)                              | Owner                                                                        | Used for                                                                      | Current redirect                                   |
| --- | -------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------- |
| 1   | **Zoen iMessage**                                  | [EnzoTironi/Plow](https://github.com/EnzoTironi/Plow) `services/oauth-relay` | iMessage Google broker (PKCE, Worker token exchange)                          | `https://auth.zoen.tironi.xyz/callback`            |
| 2   | Companion / Zoen web (the non-iMessage web client) | This repo (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` on Fly)               | Better Auth sign-in **and** Gmail/Calendar link (`/api/auth/callback/google`) | `https://zoen.tironi.xyz/api/auth/callback/google` |

Companion sign-in stays on **`app.tryzoen.com`**. The iMessage Worker should
move to **`auth.tryzoen.com`**, not onto the Fly app. Plow's Worker only accepts
a redirect that matches `https://<host>/callback`
(`services/oauth-relay/src/google.js`). Putting it at
`app.tryzoen.com/callback` would collide with Better Auth's
`/api/auth/callback/google`.

Google does **not** reliably follow 308s on OAuth redirects. Add the new URIs
**before** flipping secrets / Worker config. Do not rely on
`zoen.tironi.xyz` → `app.tryzoen.com` for `/api/auth/callback/google`.

### Client 2 — Companion Better Auth (this repo / Fly)

Console → APIs & Services → Credentials → the **existing Companion web client**
(not **Zoen iMessage**).

**Add** (keep the old rows until a test account completes sign-in + Workspace
link on `app.tryzoen.com`):

| Field                        | Value                                              |
| ---------------------------- | -------------------------------------------------- |
| Authorized JavaScript origin | `https://app.tryzoen.com`                          |
| Authorized redirect URI      | `https://app.tryzoen.com/api/auth/callback/google` |

**Keep temporarily:**

| Field                        | Value                                              |
| ---------------------------- | -------------------------------------------------- |
| Authorized JavaScript origin | `https://zoen.tironi.xyz`                          |
| Authorized redirect URI      | `https://zoen.tironi.xyz/api/auth/callback/google` |

**Do not add** on this client: `https://tryzoen.com/…`, `https://www.tryzoen.com/…`,
`https://auth.tryzoen.com/callback`. The apex 308s `/api/auth/*` to the app host,
but the IdP callback must hit Better Auth directly.

After `BETTER_AUTH_URL=https://app.tryzoen.com`, prove:

1. `https://app.tryzoen.com/sign-in` → Google → back on `app.tryzoen.com`
2. Account → Connections → Google Workspace link (same callback)

Then remove the `zoen.tironi.xyz` origin and redirect from **this** client only.

### Client 1 — Zoen iMessage Worker (Plow / Cloudflare; Enzo changes)

Worker lives in **Plow**, not this repo:

- [`services/oauth-relay/wrangler.jsonc`](https://github.com/EnzoTironi/Plow/blob/main/services/oauth-relay/wrangler.jsonc)
  — `GOOGLE_REDIRECT_URI` and `routes: [{ pattern: "auth.zoen.tironi.xyz", custom_domain: true }]`
- [`docs/GOOGLE_AUTH.md`](https://github.com/EnzoTironi/Plow/blob/main/docs/GOOGLE_AUTH.md)
- Runtime: `zoen.google_relay_url` / optional `ZOEN_GOOGLE_RELAY_URL`

**Add** on the **Zoen iMessage** client:

| Field                        | Value                               |
| ---------------------------- | ----------------------------------- |
| Authorized JavaScript origin | `https://auth.tryzoen.com`          |
| Authorized redirect URI      | `https://auth.tryzoen.com/callback` |

**Keep temporarily:**

| Field                   | Value                                   |
| ----------------------- | --------------------------------------- |
| Authorized redirect URI | `https://auth.zoen.tironi.xyz/callback` |

Then in **Plow + Cloudflare** (not a tryzoen PR):

1. DNS-only `CNAME`/`A` for `auth.tryzoen.com` → the oauth-relay Worker (same
   pattern as today's `auth.zoen.tironi.xyz` custom domain).
2. Change wrangler `GOOGLE_REDIRECT_URI` to `https://auth.tryzoen.com/callback`
   and the route pattern to `auth.tryzoen.com`; deploy the Worker.
3. Point `zoen.google_relay_url` / `ZOEN_GOOGLE_RELAY_URL` at
   `https://auth.tryzoen.com`.
4. Consent-screen branding that still cites the Worker host: homepage
   `https://tryzoen.com`, policies
   `https://auth.tryzoen.com/privacy` and `https://auth.tryzoen.com/terms`
   (today they are on `auth.zoen.tironi.xyz`). Search Console ownership for
   brand verification must include `tryzoen.com` (Plow still documents
   `tironi.xyz`).
5. Worker secrets (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
   `GOOGLE_ENCRYPTION_KEY`) stay on the Worker. Do not copy them onto Fly.

Remove `https://auth.zoen.tironi.xyz/callback` only after a real iMessage Google
link returns to `auth.tryzoen.com/callback`.
