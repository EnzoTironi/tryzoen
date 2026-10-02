import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: [
      {
        find: /^@zoen\/companion-ui$/u,
        replacement: fileURLToPath(
          new URL("packages/companion-ui/src/index.ts", import.meta.url)
        ),
      },
      {
        find: /^@zoen\/companion-ui\/i18n$/u,
        replacement: fileURLToPath(
          new URL("packages/companion-ui/src/i18n/index.ts", import.meta.url)
        ),
      },
      {
        find: "server-only",
        replacement: fileURLToPath(
          new URL("tests/helpers/server-only.ts", import.meta.url)
        ),
      },
      {
        find: /^@db$/u,
        replacement: fileURLToPath(new URL("db/index.ts", import.meta.url)),
      },
      {
        find: /^@shared\/environment$/u,
        replacement: fileURLToPath(
          new URL("shared/environment/env.ts", import.meta.url)
        ),
      },
      ...["agent", "app", "db", "evals", "shared", "tests", "tools", "web"].map(
        (owner) => ({
          find: new RegExp(`^@${owner}/(.*)$`, "u"),
          replacement: fileURLToPath(new URL(`${owner}/$1`, import.meta.url)),
        })
      ),
    ],
  },
  test: {
    // Infrastructure exercises its isolated provider packages with node:test.
    exclude: [...configDefaults.exclude, "infrastructure/**"],
    // Keep simultaneous PGlite initialization bounded while CI runs TS7 and lint.
    maxWorkers: 2,
    setupFiles: ["./tests/setup-env.ts"],
  },
});
