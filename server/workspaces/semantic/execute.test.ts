import { expect, test, vi, beforeEach } from "vitest";
import { Secret } from "../../../shared/environment/secret";
import { withSignal } from "../../operations/async";

const state = vi.hoisted(() => ({
  endpoints: ["http://127.0.0.1:18130/", "http://127.0.0.1:18131/"] as
    | string[]
    | undefined,
  fetch: vi.fn<typeof fetch>(),
}));
vi.mock("../../../shared/environment/env", () => ({
  env: {
    get ZOEN_SEMANTIC_URLS() {
      return state.endpoints;
    },
    ZOEN_SEMANTIC_TOKEN: new Secret(
      "synthetic-semantic-unit-test-token-0123456789"
    ),
  },
}));
import { executeSemanticSnapshot } from "./execute";
import { semanticLimits } from "./snapshot";
const input = {
  model: "model",
  query: "total",
  arguments: {},
  tables: [
    {
      name: "items",
      columns: [{ name: "amount", type: "numeric" as const }],
      rows: [[10], [20]],
    },
  ],
};
beforeEach(() => {
  state.endpoints = ["http://127.0.0.1:18130/", "http://127.0.0.1:18131/"];
  state.fetch.mockReset();
  vi.stubGlobal("fetch", state.fetch);
});

test("requires an explicitly configured memory-isolated runtime", async () => {
  state.endpoints = undefined;
  await expect(executeSemanticSnapshot(input)).rejects.toThrow(
    "memory-isolated executor"
  );
  expect(state.fetch).not.toHaveBeenCalled();
});
test("rejects unsafe arguments before sending source data", async () => {
  await expect(
    executeSemanticSnapshot({
      ...input,
      arguments: { minimum: 9_007_199_254_740_992 },
    })
  ).rejects.toThrow("Unsafe integer");
  expect(state.fetch).not.toHaveBeenCalled();
});
test("records the effective query and total-memory controller in its manifest", async () => {
  state.fetch.mockResolvedValue(
    new Response(JSON.stringify({ sql: "SELECT 30", rows: [{ total: 30 }] }))
  );
  const result = await executeSemanticSnapshot(input);
  expect(result.rows).toEqual([{ total: 30 }]);
  expect(result.manifest.limits).toMatchObject({
    memoryBytes: 1_610_612_736,
    memoryController: "cgroup-v2",
  });
  expect(result.manifest.sqlSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(state.fetch.mock.calls[0]?.[1]).toMatchObject({
    redirect: "error",
    method: "POST",
  });
});
test("oversized provider output is cancelled without returning it", async () => {
  state.fetch
    .mockResolvedValueOnce(new Response("x".repeat(65_537)))
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  await expect(executeSemanticSnapshot(input)).rejects.toThrow("byte limit");
  expect(state.fetch.mock.calls[1]?.[0]).toEqual(
    new URL("http://127.0.0.1:18130/cancel")
  );
});
test("aborting waits for cancellation acknowledgement before endpoint admission returns", async () => {
  const controller = new AbortController();
  const cancelled = Promise.withResolvers<Response>();
  state.endpoints = ["http://127.0.0.1:18130/"];
  state.fetch
    .mockImplementationOnce(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener(
            "abort",
            () => {
              reject(new Error("aborted"));
            },
            { once: true }
          );
        })
    )
    .mockImplementationOnce(() => cancelled.promise);
  const pending = withSignal(controller.signal, () =>
    executeSemanticSnapshot(input)
  );
  controller.abort(new Error("cancelled"));
  await expect(pending).rejects.toThrow("cancelled");
  await vi.waitFor(() => {
    expect(state.fetch).toHaveBeenCalledTimes(2);
  });
  await expect(executeSemanticSnapshot(input)).rejects.toThrow("busy");
  cancelled.resolve(new Response(null, { status: 204 }));
  state.fetch.mockResolvedValue(
    new Response(JSON.stringify({ sql: "SELECT 30", rows: [{ total: 30 }] }))
  );
  await vi.waitFor(async () => {
    expect((await executeSemanticSnapshot(input)).rows).toEqual([
      { total: 30 },
    ]);
  });
});

// The cancellation acknowledgement has its own bounded deadline. It must not
// reclassify a failure that already happened in the calculation itself.
test.each([
  [
    "worker failure",
    () => new Response(null, { status: 500 }),
    "Semantic execution failed",
  ],
  [
    "result byte limit",
    () => new Response("x".repeat(65_537)),
    "Semantic result exceeds its byte limit",
  ],
])(
  "retains the original %s when the calculation deadline expires during cleanup",
  async (_name, response, message) => {
    const deadline = new AbortController();
    const originalTimeout = AbortSignal.timeout.bind(AbortSignal);
    const timeout = vi
      .spyOn(AbortSignal, "timeout")
      .mockImplementation((milliseconds) =>
        milliseconds === semanticLimits.deadlineMs
          ? deadline.signal
          : originalTimeout(milliseconds)
      );
    state.fetch
      .mockResolvedValueOnce(response())
      .mockImplementationOnce(async () => {
        deadline.abort(new Error("deadline passed during acknowledgement"));
        return new Response(null, { status: 204 });
      });
    try {
      await expect(executeSemanticSnapshot(input)).rejects.toThrow(message);
      expect(state.fetch).toHaveBeenCalledTimes(2);
      expect(state.fetch.mock.calls[1]?.[0]).toEqual(
        new URL("http://127.0.0.1:18130/cancel")
      );
    } finally {
      timeout.mockRestore();
    }
  }
);

test("preserves an execution deadline that was reached before cleanup", async () => {
  const deadline = new AbortController();
  const originalTimeout = AbortSignal.timeout.bind(AbortSignal);
  const timeout = vi
    .spyOn(AbortSignal, "timeout")
    .mockImplementation((milliseconds) =>
      milliseconds === semanticLimits.deadlineMs
        ? deadline.signal
        : originalTimeout(milliseconds)
    );
  state.fetch
    .mockImplementationOnce(async () => {
      deadline.abort(new Error("execution deadline"));
      throw new Error("transport source details must stay opaque");
    })
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  try {
    await expect(executeSemanticSnapshot(input)).rejects.toThrow(
      "Semantic execution deadline reached"
    );
  } finally {
    timeout.mockRestore();
  }
});
