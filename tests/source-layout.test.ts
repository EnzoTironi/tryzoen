import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("source layout", () => {
  it("keeps the Eve agent and Next route tree at the repository root", () => {
    expect(existsSync("agent/agent.ts")).toBe(true);
    expect(existsSync("agent/instructions.md")).toBe(true);
    expect(existsSync("app/layout.tsx")).toBe(true);
    expect(existsSync("app/(companion)/page.tsx")).toBe(true);
    expect(existsSync("app/companion/[[...session]]/page.tsx")).toBe(true);
    expect(existsSync("app/(authenticated)/legacy/page.tsx")).toBe(true);
    expect(existsSync("proxy.ts")).toBe(true);
    expect(existsSync("src")).toBe(false);
  });

  it("keeps browser support and cross-boundary contracts explicitly owned", () => {
    expect(existsSync("shared/environment/env.ts")).toBe(true);
    expect(existsSync("agent/subagents/browser-agent/lib/kernel.ts")).toBe(
      true
    );
    expect(existsSync("db/services/installation-secrets.ts")).toBe(true);
    expect(existsSync("evals/browser/worker-events.ts")).toBe(true);
  });
});
