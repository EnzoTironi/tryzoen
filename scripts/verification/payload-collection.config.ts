import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import appConfig from "../../vitest.config.ts";

export default defineConfig({
  root: fileURLToPath(new URL("../../", import.meta.url)),
  resolve: appConfig.resolve,
  test: {
    include: ["tests/runtime/payload-collection.native.ts"],
    setupFiles: ["tests/runtime/setup.ts"],
    maxWorkers: 1,
    fileParallelism: false,
    testTimeout: 30_000,
    env: { NODE_ENV: "test" },
  },
});
