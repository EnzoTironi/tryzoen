import { defineConfig } from "vitest/config";
import appConfig from "../../vitest.config.ts";

export default defineConfig({
  resolve: appConfig.resolve,
  test: {
    include: ["tests/runtime/matrix-lock-order.proof.ts"],
    setupFiles: ["./tests/runtime/setup.ts"],
    maxWorkers: 1,
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
