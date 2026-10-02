import { defineConfig } from "vitest/config";
import appConfig from "./vitest.config.ts";

export default defineConfig({
  resolve: appConfig.resolve,
  test: {
    setupFiles: ["./tests/runtime/setup.ts"],
    testTimeout: 30_000,
    fileParallelism: false,
    // Positive groups keep the pristine corpus phase ahead of Vitest's serial default group.
    projects: [
      {
        extends: true,
        test: {
          name: "creator-corpus",
          include: ["tests/runtime/creator-corpus.integration.ts"],
          sequence: { groupOrder: 1 },
        },
      },
      {
        extends: true,
        test: {
          name: "runtime",
          include: ["tests/runtime/*.integration.ts"],
          exclude: ["tests/runtime/creator-corpus.integration.ts"],
          sequence: { groupOrder: 2 },
        },
      },
    ],
  },
});
