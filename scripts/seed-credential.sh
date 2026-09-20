#!/bin/sh
# A retained volume preserves refreshed OAuth credentials. Only a changed deployment
# secret intentionally replaces them. Read the secret from stdin, never arguments.
set -eu
umask 077
credential_path=$1
mkdir -p "$(dirname "$credential_path")"
seed_temp=$(mktemp "$credential_path.seed.XXXXXX")
trap 'rm -f "$seed_temp" "$seed_temp.digest"' EXIT HUP INT TERM
cat > "$seed_temp"
# Validate before replacing a retained login. Never print the supplied credential.
node - "$seed_temp" "$seed_temp.digest" <<'JS'
const fs = require('node:fs');
const crypto = require('node:crypto');
const bytes = fs.readFileSync(process.argv[2]);
try {
  const auth = JSON.parse(bytes);
  if (auth.auth_mode !== 'chatgpt' || !['access_token', 'refresh_token', 'id_token'].every(
    key => typeof auth.tokens?.[key] === 'string' && auth.tokens[key].trim()
  )) throw new Error();
} catch {
  console.error('CODEX_AUTH_JSON must contain a native managed ChatGPT auth.json with access, refresh and ID tokens.');
  process.exit(1);
}
fs.writeFileSync(process.argv[3], crypto.createHash('sha256').update(bytes).digest('hex'), { mode: 0o600 });
JS
if [ ! -s "$credential_path" ] || ! cmp -s "$seed_temp.digest" "$credential_path.seed-digest"; then
  mv "$seed_temp" "$credential_path"
  mv "$seed_temp.digest" "$credential_path.seed-digest"
fi
