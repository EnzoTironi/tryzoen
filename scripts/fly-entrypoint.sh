#!/bin/sh
# Fly Machine entrypoint: seed native Codex auth on the retained volume, then start.
# CODEX_AUTH_JSON is the complete file-backed Codex auth.json, supplied through stdin.
# Never logs or echoes secret values.
set -eu
umask 077

# Workspace Git bundles and authority use the application's durable Postgres.
: "${DATABASE_URL:?DATABASE_URL is required}"

if [ -n "${CODEX_AUTH_JSON:-}" ]; then
  : "${CODEX_HOME:?CODEX_HOME must point at the retained model-auth volume}"
  printf %s "$CODEX_AUTH_JSON" | sh /app/scripts/seed-credential.sh "$CODEX_HOME/auth.json"
fi

unset CODEX_AUTH_JSON

if [ "${COMPANION_MODEL_PROVIDER:-}" = codex-local ] || [ "${COMPANION_BROWSER_MODEL_PROVIDER:-}" = codex-local ]; then
  : "${CODEX_HOME:?CODEX_HOME must point at the retained model-auth volume}"
  mkdir -p "$CODEX_HOME"
  printf 'cli_auth_credentials_store = "file"\n' > "$CODEX_HOME/config.toml"
  if ! codex login status >/dev/null 2>&1; then
    echo 'Native Codex login is unavailable. Seed CODEX_AUTH_JSON with a current ChatGPT login.' >&2
    exit 1
  fi
fi

# Same args as historical Dockerfile CMD (Fly IPv6 health + Eve rewrite port).
exec pnpm start --port 3000 --hostname :: --eve-port 4274
