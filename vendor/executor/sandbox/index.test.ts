import { sleep } from "../../../server/operations/async";
import { describe, expect, it } from "vitest";

import type { SandboxToolInvoker } from "../core";
import { makeQuickJsExecutor } from "./index";

class UnknownToolError extends Error {
  constructor({ path }: { path: string }) {
    super(`Unknown tool: ${path}`);
  }
}

const makeTestInvoker = (
  handlers: Record<string, (args: unknown) => unknown>
): SandboxToolInvoker => ({
  invoke: ({ path, args }) => {
    const handler = handlers[path];
    if (!handler) {
      return Promise.reject(new UnknownToolError({ path }));
    }
    return Promise.resolve()
      .then(async () => handler(args))
      .catch((error) => {
        throw ((error) => error)(error);
      });
  },
});

const executor = makeQuickJsExecutor({ timeoutMs: 5_000 });

describe("quickjs executor", () => {
  it("interrupts compute while an unawaited host call is in flight and cancels that call", async () => {
    let ended = false;
    const result = await makeQuickJsExecutor({
      timeoutMs: 100,
      maxWallTimeMs: 500,
    }).execute("tools.slow({}); while (true) {}", {
      invoke: (_call, signal) =>
        new Promise((_, reject) => {
          const abort = () => {
            ended = true;
            reject(signal?.reason);
          };
          signal?.addEventListener("abort", abort, { once: true });
          if (signal?.aborted) abort();
        }),
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.error).toContain("timed out");
    expect(ended).toBe(true);
  });

  it("bounds time waiting for a host call which never resolves", async () => {
    let ended = false;
    const result = await makeQuickJsExecutor({
      timeoutMs: 100,
      maxWallTimeMs: 150,
    }).execute("return await tools.slow({});", {
      invoke: (_call, signal) =>
        new Promise((_, reject) => {
          const abort = () => {
            ended = true;
            reject(signal?.reason);
          };
          signal?.addEventListener("abort", abort, { once: true });
          if (signal?.aborted) abort();
        }),
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.error).toContain("timed out");
    expect(ended).toBe(true);
  });

  it("runs plain code", () =>
    (async function () {
      const result = await executor.execute(
        `return 1 + 2`,
        makeTestInvoker({})
      );
      expect(result.result).toBe(3);
      expect(result.error).toBeUndefined();
    })());

  it("accumulates helper output separately from returned data", () =>
    (async function () {
      const result = await executor.execute(
        `
        const attachment = {
          _tag: "ToolFile",
          name: "photo.png",
          mimeType: "image/png",
          encoding: "base64",
          data: "iVBORw0KGgo=",
          byteLength: 8,
        };
        const values = [
          emit("hello"),
          emit(attachment),
          emit({ type: "text", text: "mcp hello" }),
          emit({ type: "image", data: "Zm9v", mimeType: "image/png" }),
          emit({ type: "audio", data: "SUQz", mimeType: "audio/mpeg" }),
          emit({
            type: "resource",
            resource: { uri: "executor-file:///report.pdf", mimeType: "application/pdf", blob: "JVBERg==" },
          }),
          emit({
            type: "resource_link",
            uri: "executor-file:///remote.pdf",
            name: "remote.pdf",
            mimeType: "application/pdf",
          }),
          emit({ arbitrary: true }),
        ];
        return { values: values.map((value) => value === undefined), keptReturn: true };
        `,
        makeTestInvoker({})
      );

      expect(result.error).toBeUndefined();
      expect(result.result).toEqual({
        values: [true, true, true, true, true, true, true, true],
        keptReturn: true,
      });
      expect(result.output).toEqual([
        { type: "content", content: { type: "text", text: "hello" } },
        {
          type: "file",
          file: {
            _tag: "ToolFile",
            name: "photo.png",
            mimeType: "image/png",
            encoding: "base64",
            data: "iVBORw0KGgo=",
            byteLength: 8,
          },
        },
        { type: "content", content: { type: "text", text: "mcp hello" } },
        {
          type: "content",
          content: { type: "image", data: "Zm9v", mimeType: "image/png" },
        },
        {
          type: "content",
          content: { type: "audio", data: "SUQz", mimeType: "audio/mpeg" },
        },
        {
          type: "content",
          content: {
            type: "resource",
            resource: {
              uri: "executor-file:///report.pdf",
              mimeType: "application/pdf",
              blob: "JVBERg==",
            },
          },
        },
        {
          type: "content",
          content: {
            type: "resource_link",
            uri: "executor-file:///remote.pdf",
            name: "remote.pdf",
            mimeType: "application/pdf",
          },
        },
        {
          type: "content",
          content: { type: "text", text: '{"arbitrary":true}' },
        },
      ]);
    })());

  it("recovers prose-wrapped fenced async arrow input", () =>
    (async function () {
      const result = await executor.execute(
        ["Use this snippet.", "", "```ts", "async () => 42", "```"].join("\n"),
        makeTestInvoker({})
      );

      expect(result.result).toBe(42);
      expect(result.error).toBeUndefined();
    })());

  it("invokes a tool and returns its result", () =>
    (async function () {
      const invoker = makeTestInvoker({
        "math.add": (args) => {
          const { a, b } = args as { a: number; b: number };
          return { sum: a + b };
        },
      });

      const result = await executor.execute(
        `
        const res = await tools.math.add({ a: 5, b: 3 });
        return res.sum;
        `,
        invoker
      );

      expect(result.error).toBeUndefined();
      expect(result.result).toBe(8);
    })());

  it("suspends the execution deadline while a tool dispatch is in flight", async () => {
    const timeoutMs = 100;
    const slowInvoker: SandboxToolInvoker = {
      invoke: () =>
        Promise.resolve()
          .then(async () => sleep(timeoutMs * 3))
          .then(async () => "slow result"),
    };
    const slowExecutor = makeQuickJsExecutor({ timeoutMs });

    const result = await slowExecutor.execute(
      "return await tools.slow.wait({});",
      slowInvoker
    );

    expect(result.error).toBeUndefined();
    expect(result.result).toBe("slow result");
  });

  it("still times out continuous autonomous compute", async () => {
    const timeoutMs = 100;
    const timedExecutor = makeQuickJsExecutor({ timeoutMs });

    const result = await timedExecutor.execute(
      "while (true) {}",
      makeTestInvoker({})
    );

    expect(result.result).toBeNull();
    expect(result.error).toBe(
      `QuickJS execution timed out after ${timeoutMs}ms`
    );
  });

  it("resets the execution deadline after a tool dispatch returns", async () => {
    const timeoutMs = 100;
    const slowInvoker: SandboxToolInvoker = {
      invoke: () =>
        Promise.resolve()
          .then(async () => sleep(timeoutMs * 3))
          .then(async () => "done"),
    };
    const timedExecutor = makeQuickJsExecutor({ timeoutMs });

    const result = await timedExecutor.execute(
      `
        await tools.slow.wait({});
        while (true) {}
        `,
      slowInvoker
    );

    expect(result.result).toBeNull();
    expect(result.error).toBe(
      `QuickJS execution timed out after ${timeoutMs}ms`
    );
  });

  it("invokes multiple tools in sequence", () =>
    (async function () {
      const invoker = makeTestInvoker({
        "users.get": (args) => {
          const { id } = args as { id: number };
          return { id, name: `User ${id}` };
        },
        "users.greet": (args) => {
          const { name } = args as { name: string };
          return { message: `Hello, ${name}!` };
        },
      });

      const result = await executor.execute(
        `
        const user = await tools.users.get({ id: 42 });
        const greeting = await tools.users.greet({ name: user.name });
        return greeting.message;
        `,
        invoker
      );

      expect(result.error).toBeUndefined();
      expect(result.result).toBe("Hello, User 42!");
    })());

  it("handles tool errors", () =>
    (async function () {
      const invoker = makeTestInvoker({
        "db.query": () => {
          throw new Error("connection refused");
        },
      });

      const result = await executor.execute(
        `
        try {
          await tools.db.query({ sql: "SELECT 1" });
          return "should not reach";
        } catch (e) {
          return "caught: " + e.message;
        }
        `,
        invoker
      );

      expect(result.error).toBeUndefined();
      expect(result.result).toContain("caught:");
    })());

  it("internal defects reach the sandbox as an opaque generic only", () =>
    (async function () {
      // Plugin defect carrying sensitive context. The bridge's reject
      // path must strip everything except the canonical
      // "Internal tool error [<corrId>]" shape — or fall back to the
      // bare generic if the upstream invoker hasn't already stamped
      // the correlation id (this test exercises the latter path
      // because it bypasses makeExecutorToolInvoker).
      const invoker: SandboxToolInvoker = {
        invoke: () =>
          Promise.reject(
            Object.assign(
              new Error(
                "Authorization: Bearer SECRET_TOKEN_xyz failed against host 10.0.0.5"
              ),
              {
                stack:
                  "Error\n    at /home/svc/executor/packages/plugins/foo:142:11",
              }
            ) as never
          ),
      };

      const result = await executor.execute(
        `
        try {
          await tools.leaky.call({});
          return "should not reach";
        } catch (e) {
          return e.message;
        }
        `,
        invoker
      );

      expect(result.error).toBeUndefined();
      const message = String(result.result);
      // Either the canonical opaque generic with a correlation id, or
      // the bare fallback. Neither must contain any sensitive context.
      expect(
        message === "Internal tool error" ||
          /^Internal tool error \[[0-9a-f]{8}\]$/.test(message)
      ).toBe(true);
      expect(message).not.toContain("SECRET_TOKEN_xyz");
      expect(message).not.toContain("Authorization");
      expect(message).not.toContain("10.0.0.5");
      expect(message).not.toContain("packages/plugins");
    })());

  it("handles unknown tool path", () =>
    (async function () {
      const invoker = makeTestInvoker({});

      const result = await executor.execute(
        `
        try {
          await tools.nonexistent.thing({ x: 1 });
          return "should not reach";
        } catch (e) {
          return "caught: " + e.message;
        }
        `,
        invoker
      );

      expect(result.error).toBeUndefined();
      expect(result.result).toContain("caught:");
    })());

  it("captures console.log output", () =>
    (async function () {
      const result = await executor.execute(
        `
        console.log("hello from sandbox");
        console.warn("a warning");
        return "done";
        `,
        makeTestInvoker({})
      );

      expect(result.error).toBeUndefined();
      expect(result.result).toBe("done");
      expect(result.logs).toContainEqual("[log] hello from sandbox");
      expect(result.logs).toContainEqual("[warn] a warning");
    })());

  it("applies a memory limit by default", () =>
    (async function () {
      const defaultExecutor = makeQuickJsExecutor({ timeoutMs: 5_000 });

      const result = await defaultExecutor.execute(
        `
        return new ArrayBuffer(128 * 1024 * 1024).byteLength;
        `,
        makeTestInvoker({})
      );

      expect(result.result).toBeNull();
      expect(result.error).toBeDefined();
    })());

  it("passes tool result into next tool call", () =>
    (async function () {
      const invoker = makeTestInvoker({
        "stripe.customers.list": () => ({
          data: [
            { id: "cus_1", email: "alice@example.com" },
            { id: "cus_2", email: "bob@example.com" },
          ],
        }),
        "stripe.invoices.create": (args) => {
          const { customer, amount } = args as {
            customer: string;
            amount: number;
          };
          return { id: "inv_1", customer, amount };
        },
      });

      const result = await executor.execute(
        `
        const customers = await tools.stripe.customers.list();
        const invoice = await tools.stripe.invoices.create({
          customer: customers.data[0].id,
          amount: 5000,
        });
        return invoice;
        `,
        invoker
      );

      expect(result.error).toBeUndefined();
      expect(result.result).toEqual({
        id: "inv_1",
        customer: "cus_1",
        amount: 5000,
      });
    })());

  it("tools proxy throws a search hint on enumeration", () =>
    (async function () {
      const result = await executor.execute(
        `
        const outcomes = {};
        try {
          Object.keys(tools);
          outcomes.keys = "no error";
        } catch (e) {
          outcomes.keys = e instanceof Error ? e.message : String(e);
        }
        try {
          ({ ...tools.github });
          outcomes.spread = "no error";
        } catch (e) {
          outcomes.spread = e instanceof Error ? e.message : String(e);
        }
        return outcomes;
        `,
        makeTestInvoker({})
      );

      expect(result.error).toBeUndefined();
      expect(result.result).toEqual({
        keys: 'tools is a lazy proxy and cannot be enumerated. Use tools.search({ query: "..." }) to find tools, tools.search({ namespace: "<integration>", query: "" }) to list every tool in an integration, or tools.executor.coreTools.connections.list({}) to list saved connections.',
        spread:
          'tools.github is a lazy proxy and cannot be enumerated. Use tools.search({ query: "..." }) to find tools, tools.search({ namespace: "<integration>", query: "" }) to list every tool in an integration, or tools.executor.coreTools.connections.list({}) to list saved connections.',
      });
    })());

  it("tools proxy still invokes and chains after the enumeration traps", () =>
    (async function () {
      const result = await executor.execute(
        `
        try { Object.keys(tools); } catch {}
        return tools.a.b.c({});
        `,
        makeTestInvoker({ "a.b.c": () => "a.b.c" })
      );

      expect(result.error).toBeUndefined();
      expect(result.result).toBe("a.b.c");
    })());
});
