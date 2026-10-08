import type { KnipConfig } from "knip";

export default {
  workspaces: {
    ".": {
      vitest: {
        config: [
          "vitest.config.ts",
          "vitest.runtime.config.ts",
          "tests/runtime/matrix-security.config.ts",
          "scripts/verification/*.config.ts",
        ],
      },
      entry: [
        // Supplement filesystem slots missing from Knip's built-in Eve plugin.
        "agent/{instructions,instrumentation,memory}{.ts,/**/*.ts}!",
        "agent/subagents/**/{instructions,memory}{.ts,/**/*.ts}!",
        "tests/fixtures/eve-*/agent/agent.ts",
        "tests/fixtures/eve-*/agent/{channels,hooks,memory,tools}/**/*.ts",
        "tests/fixtures/eve-*/agent/subagents/**/{agent.ts,hooks/**/*.ts}",
        "db/drizzle.config.ts",
        // Drizzle consumes every table and relation exported by this schema barrel.
        "db/schema/index.ts!",
        "evals/**/*.eval.ts",
        "evals/evals.config.ts",
        "taze.config.ts",
        // Standalone real PostgreSQL check invoked by test:google-membership.
        "server/google-workspace/membership.integration.ts",
        // Live TG group mention e2e (manual /env.local); fixture harness is CI proof.
        "scripts/groups-live-e2e.ts",
        // Process roots not fully retained by package-script discovery in production.
        "scripts/{start,reconcile-account-erasures,migrate-hosted}.ts!",
        // Dedicated execution capsule and standalone synthetic performance runner.
        "server/workspaces/semantic/worker.ts!",
        "server/workspaces/semantic/service.ts!",
        "benchmarks/performance/run.ts",
        // Read-only platform prerequisite inventory, invoked independently of native builds.
        "scripts/native-readiness.ts",
        // The protected audit job executes the installed cache's behavior directly.
        "scripts/audit/cache-regressions.mjs",
        // Manual CDP regression against the isolated shared conversation UI.
        "tests/companion/composer-hit-targets.ts",
      ],
      ignoreDependencies: [
        "react-native-svg",
        // 4.3 advertises index.js as its types; the audit check uses DefinitelyTyped.
        "@types/http-cache-semantics",
        // Eve evaluates shared reaction schemas from root-authored module bundles.
        "unicode-emoji-json",
        // Eve also resolves the shared vault schema's parser from its root bundle.
        "credit-card-type",
        // The import worker invokes the native CLI in an isolated Node process.
        "@firecrawl/anydoc",
        // Loaded as jsPlugins from .oxlintrc.jsonc rather than TypeScript.
        "eslint-plugin-react-hooks",
        "eslint-plugin-turbo",
        "oxlint-tailwindcss",
      ],
      // The local pilot resolves the existing Codex CLI login, outside npm.
      ignoreBinaries: ["codex"],
      project: [
        "**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs,css}!",
        "!infrastructure/**",
        // Runtime suites compile disposable copies of the authored fixtures here.
        "!tests/fixtures/.eve-*/**",
        // These directories stay in normal analysis, outside the product graph.
        "!tests/**!",
        "!evals/**!",
        "!benchmarks/**!",
      ],
    },
    "apps/mobile": {},
    "apps/desktop": {},
    "packages/companion-ui": {},
    infrastructure: {
      entry: [
        "{alchemy.run,alchemy.fly-postgres.run,recovery.run,operations}.ts!",
        "semantic/probe.mjs!",
        "tests/*.test.ts",
      ],
      project: ["**/*.{ts,mjs}!", "!tests/**!"],
      // POSIX shell builtin used to protect local Alchemy state.
      ignoreBinaries: ["umask"],
    },
  },
} satisfies KnipConfig;
