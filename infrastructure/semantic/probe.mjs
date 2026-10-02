import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

// oxlint-disable-next-line eslint/no-restricted-properties -- This standalone deployment probe validates its two settings below.
const environment = process.env;
const origin = process.argv[2] ?? environment.ZOEN_SEMANTIC_URLS?.split(",")[0];
const token = environment.ZOEN_SEMANTIC_TOKEN;
assert.ok(
  origin && token && /^[A-Za-z0-9_-]{32,128}$/.test(token),
  "Semantic configuration is missing"
);
const headers = {
  authorization: `Bearer ${token}`,
  "content-type": "application/json",
  "x-execution-id": randomUUID(),
};
/** @param {string} path @param {RequestInit} [init] */
const request = (path, init) =>
  fetch(new URL(path, origin), {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
assert.equal(
  (await request("health")).status,
  401,
  "Anonymous execution must be rejected"
);
assert.equal(
  (await request("health", { headers })).status,
  204,
  "Semantic health failed"
);
const response = await request("execute", {
  method: "POST",
  headers,
  body: JSON.stringify({
    model:
      "source: items is snapshot.table('public.items')\nquery: total is items -> { aggregate: total is amount.sum() }",
    query: "total",
    arguments: {},
    tables: [
      {
        name: "items",
        columns: [{ name: "amount", type: "numeric" }],
        rows: [[10], [20]],
      },
    ],
  }),
});
assert.equal(response.status, 200, "Semantic calculation failed");
/** @type {unknown} */
const result = await response.json();
assert.ok(result && typeof result === "object" && "rows" in result);
assert.deepEqual(result.rows, [{ total: 30 }]);
console.log("Semantic authentication, health and isolated calculation passed");
