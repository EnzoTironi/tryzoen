import type { KnipConfig } from "knip";

export default {
  ignoreIssues: {
    // Eve AI Elements and shadcn registry primitives intentionally expose
    // a reusable component surface wider than this minimal chat consumes.
    "web/components/ai-elements/**/*.tsx": ["exports", "files", "types"],
    "web/components/ui/**/*.tsx": ["exports", "files", "types"],
  },
  workspaces: {
    ".": {
      vitest: {
        config: ["vitest.config.ts", "vitest.runtime.config.ts"],
      },
      entry: [
        "agent/channels/**/*.ts",
        "agent/instrumentation/**/*.ts",
        "tests/fixtures/eve-*/agent/**/*.ts",
        "agent/hooks/**/*.ts",
        "agent/instructions/**/*.ts",
        "agent/memory/**/*.ts",
        "agent/skills/**/*.ts",
        "agent/subagents/**/*.ts",
        "agent/schedules/**/*.ts",
        "agent/tools/**/*.ts",
        "db/drizzle.config.ts",
        // Drizzle consumes every table and relation exported by this schema barrel.
        "db/schema/index.ts",
        "evals/**/*.eval.ts",
        "evals/evals.config.ts",
        "taze.config.ts",
        // Standalone real PostgreSQL check invoked by test:google-membership.
        "server/google-workspace/membership.integration.ts",
        // Live TG group mention e2e (manual /env.local); fixture harness is CI proof.
        "scripts/groups-live-e2e.ts",
        // Launched in a separate process before web/worker traffic is admitted.
        "scripts/reconcile-account-erasures.ts",
        // Dedicated execution capsule and standalone synthetic performance runner.
        "server/workspaces/semantic/worker.ts",
        "server/workspaces/semantic/service.ts",
        "benchmarks/performance/run.ts",
        // Read-only platform prerequisite inventory, invoked independently of native builds.
        "scripts/native-readiness.ts",
        // Manual CDP regression against the isolated shared conversation UI.
        "tests/companion/composer-hit-targets.ts",
      ],
      ignoreDependencies: [
        // Next resolves React Native imports to this web renderer.
        "react-native-web",
        "react-native-svg",
        // Eve evaluates shared reaction schemas from root-authored module bundles.
        "unicode-emoji-json",
        // Eve also resolves the shared vault schema's parser from its root bundle.
        "credit-card-type",
        // The import worker invokes the native CLI in an isolated Node process.
        "@firecrawl/anydoc",
        // Imported through the owning Tailwind stylesheet rather than TypeScript.
        "shadcn",
        "tailwindcss",
        // Loaded as jsPlugins from .oxlintrc.jsonc rather than TypeScript.
        "eslint-plugin-react-hooks",
        "eslint-plugin-turbo",
        "oxlint-tailwindcss",
      ],
      project: ["**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}", "!infrastructure/**"],
    },
    "apps/mobile": {
      entry: ["index.ts", "metro.config.mjs"],
    },
    "apps/desktop": { entry: ["src/main.ts"] },
    "packages/companion-ui": { entry: ["src/index.ts"] },
    infrastructure: {
      entry: [
        "alchemy.run.ts",
        "alchemy.fly-postgres.run.ts",
        "recovery.run.ts",
        "tests/*.test.ts",
      ],
      // POSIX shell builtin used to protect local Alchemy state.
      ignoreBinaries: ["umask"],
    },
  },
} satisfies KnipConfig;
