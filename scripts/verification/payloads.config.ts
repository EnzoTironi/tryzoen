import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL("../../", import.meta.url));

export default defineConfig({
  root,
  resolve: {
    alias: [{ find: /^@shared\/(.*)$/u, replacement: `${root}shared/$1` }],
  },
  test: {
    include: ["server/payloads/*.test.ts", "server/payloads/*.integration.ts"],
    maxWorkers: 1,
    env: {
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://synthetic:synthetic@127.0.0.1:1/synthetic",
    },
  },
});
