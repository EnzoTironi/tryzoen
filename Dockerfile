# Companion always-on image: paired Next + Eve via `pnpm start`.
# Alchemy Docker Postgres stays outside this image (see docs/ops/hosted-fly.md).
# syntax=docker/dockerfile:1

FROM debian:bookworm-slim AS memory-engine
ARG TARGETARCH
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl git \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /tmp/ai-memory
RUN case "$TARGETARCH" in \
      amd64) release=x86_64; checksum=15cafdc48eabc0305c164ccc8e884b260275f5a88b4f26e8456c2e42156375e4 ;; \
      arm64) release=aarch64; checksum=f5fbe2ba7f21469cb473c6cdfc74d62c01eaaaea1b792e3a0251953169589bfd ;; \
      *) exit 1 ;; \
    esac \
  && curl -fsSL "https://github.com/akitaonrails/ai-memory/releases/download/v2.4.1/ai-memory-linux-${release}.tar.gz" -o release.tar.gz \
  && printf '%s  release.tar.gz\n' "$checksum" | sha256sum -c - \
  && tar xzf release.tar.gz \
  && install -m 755 ai-memory /usr/local/bin/ai-memory \
  && install -Dm 644 LICENSE /usr/local/share/licenses/ai-memory/LICENSE \
  && /usr/local/bin/ai-memory --version

FROM node:24-bookworm-slim AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.24.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
COPY packages/companion-ui/package.json ./packages/companion-ui/package.json
# Desktop packaging and mobile tooling are not part of the server image.
RUN pnpm --filter local-vault-assistant... install --frozen-lockfile

FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.24.0 --activate
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages ./packages
COPY --from=deps /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY . .
# Channel rewrites bake Eve's loopback port at build time — keep start args matched.
ENV EVE_NEXT_PRODUCTION_PORT=4274
ENV NEXT_TELEMETRY_DISABLED=1
# Depot remote builders OOM (exit 137) on default heap + Next/TS peak RSS.
# Cap V8 heap so GC stays aggressive on small Depot RAM; split Eve/Next.
ENV NODE_OPTIONS=--max-old-space-size=2048
ENV OPEN_INSTINCT_LOW_MEM_BUILD=1
# Build-time placeholders only; runtime secrets come from Fly (never bake .env*).
ENV BETTER_AUTH_URL=http://127.0.0.1:3000
ENV COMPANION_PUBLIC_BASE_URL=http://127.0.0.1:3000
ENV DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/open_instinct_prod
ENV DATABASE_URL_UNPOOLED=postgresql://postgres:postgres@127.0.0.1:5432/open_instinct_prod
# Skip turbo daemon; run Eve then Next in separate layers (RSS reclaim between).
RUN pnpm --filter @zoen/companion-ui build:ui
RUN pnpm exec eve build
RUN pnpm exec next build

FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV EVE_NEXT_PRODUCTION_PORT=4274
ENV CODEX_HOME=/root/.eve/auth/codex
RUN corepack enable && corepack prepare pnpm@11.24.0 --activate \
  && apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates ffmpeg git util-linux \
  && rm -rf /var/lib/apt/lists/*
RUN npm install --global @openai/codex@0.155.1 && codex --version
COPY --from=memory-engine /usr/local/bin/ai-memory /usr/local/bin/ai-memory
COPY --from=memory-engine /usr/local/share/licenses/ai-memory /usr/local/share/licenses/ai-memory
COPY --from=build /app /app
RUN chmod +x /app/scripts/fly-entrypoint.sh \
  && node -e "require.resolve('just-bash'); require.resolve('@firecrawl/anydoc/cli.js'); require.resolve('quickjs-emscripten')" \
  && git --version \
  && ffprobe -version
# Eve optional peer: just-bash (bash tool / sandbox). Fail the image build if missing.
# Next binds all families for Fly proxy/health (IPv6); Eve stays on loopback.
# Eve uses the official Codex app-server with credentials on the retained volume.
EXPOSE 3000
CMD ["/app/scripts/fly-entrypoint.sh"]
