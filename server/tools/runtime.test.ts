import { expect, test } from "vitest";
import { runCustomerCode } from "./runtime";

test("the owned Executor kernel has no ambient process, network or filesystem", async () => {
  const result = await runCustomerCode(
    "return [typeof process, typeof require, typeof fetch, typeof WebSocket, 6 * 7];",
    {
      invoke: async () => {
        throw new Error("No tool should be called");
      },
    }
  );
  expect(result).toMatchObject({ ok: true });
  expect(JSON.parse(result.text)).toMatchObject({
    result: ["undefined", "undefined", "function", "undefined", 42],
  });
  const network = await runCustomerCode(
    'return await fetch("https://example.invalid");',
    {
      invoke: async () => {
        throw new Error("No tool should be called");
      },
    }
  );
  expect(network.ok).toBe(false);
  expect(network.text).toContain("fetch is disabled");
});

test("CPU, logs, host calls and output are bounded", async () => {
  const invoker = { invoke: () => Promise.resolve({ value: 1 }) };
  const infinite = await runCustomerCode("while (true) {}", invoker);
  expect(infinite.ok).toBe(false);
  const logged = await runCustomerCode(
    'for(let i=0;i<100;i++) console.log("x".repeat(3000)); return 1;',
    invoker
  );
  expect(logged.logs).toHaveLength(64);
  expect(logged.logs.every((line) => line.length < 1040)).toBe(true);
  const excessive = await runCustomerCode(
    "for(let i=0;i<13;i++) await tools.example({});",
    invoker
  );
  expect(excessive.ok).toBe(false);
  const output = await Promise.try(async () =>
    runCustomerCode('return "x".repeat(140000);', invoker)
  ).then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error })
  );
  expect(!output.ok && output.error).toMatchObject({
    reason: "limit_exceeded",
  });
});

test("the bridge never exposes a failed host operation's private details", async () => {
  const result = await runCustomerCode("return await tools.secret({});", {
    invoke: () => Promise.reject(new Error("PRIVATE TOKEN IN HOST ERROR")),
  });
  expect(result.ok).toBe(false);
  expect(result.text).not.toContain("PRIVATE TOKEN");
});

test("a missing return is not misreported as empty workspace data", async () => {
  let calls = 0;
  const result = await runCustomerCode(
    "const files = await tools.list({}); files",
    {
      invoke: async () => {
        calls += 1;
        return { files: ["knowledge/launch.md"] };
      },
    }
  );
  expect(calls).toBe(1);
  expect(result.ok).toBe(false);
  expect(result.text).toContain("explicit return");
});
