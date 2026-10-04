/// <reference types="node" />
/// <reference types="http-cache-semantics" />
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import CachePolicy from "http-cache-semantics";

// Exercise the installed downloader's actual dependency, including pnpm's patch.
const desktop = createRequire(
  new URL("../../apps/desktop/package.json", import.meta.url)
);
const builder = createRequire(desktop.resolve("electron-builder"));
const applicationBuilder = createRequire(builder.resolve("app-builder-lib"));
const downloader = createRequire(applicationBuilder.resolve("@electron/get"));
const got = createRequire(downloader.resolve("got"));
const cache = createRequire(got.resolve("cacheable-request"));
const audit = createRequire(import.meta.url);
assert.equal(
  cache.resolve("http-cache-semantics"),
  audit.resolve("http-cache-semantics")
);
const request = {
  url: "https://synthetic.invalid/download",
  method: "GET",
  headers: { host: "synthetic.invalid" },
};
const stale = "max-age=0, stale-while-revalidate=600, stale-if-error=600";

for (const reason of [
  "shared-cookie",
  "no-cache",
  "private",
  "no-store",
  "proxy-revalidate",
  "must-revalidate",
  "vary-star",
  "authenticated",
  "request-no-store",
]) {
  await test(`installed cache never reuses ${reason} through stale directives`, () => {
    const originalRequest = {
      ...request,
      headers: {
        ...request.headers,
        ...(reason === "authenticated"
          ? { authorization: "Bearer synthetic-only" }
          : {}),
        ...(reason === "request-no-store"
          ? { "cache-control": "no-store" }
          : {}),
      },
    };
    const policy = new CachePolicy(
      originalRequest,
      {
        status: 200,
        headers: {
          date: new Date().toUTCString(),
          age: "1",
          "cache-control":
            stale +
            ([
              "no-cache",
              "private",
              "no-store",
              "proxy-revalidate",
              "must-revalidate",
            ].includes(reason)
              ? `, ${reason}`
              : ""),
          ...(reason === "shared-cookie"
            ? { "set-cookie": "synthetic-account=A" }
            : {}),
          ...(reason === "vary-star" ? { vary: "*" } : {}),
        },
      },
      { shared: true }
    );
    // Serialized cache entries must retain the same restrictions after restart.
    for (const entry of [policy, CachePolicy.fromObject(policy.toObject())]) {
      for (const directive of ["max-stale", "max-stale=999999"]) {
        const incoming = {
          ...request,
          headers: { ...request.headers, "cache-control": directive },
        };
        assert.equal(entry.satisfiesWithoutRevalidation(incoming), false);
        assert.equal(entry.evaluateRequest(incoming).response, undefined);
        assert.equal(
          entry.evaluateRequest(incoming).revalidation?.synchronous,
          true
        );
      }
      assert.equal(entry.evaluateRequest(request).response, undefined);
      assert.equal(entry.timeToLive(), 0);
      const failedOrigin = entry.revalidatedPolicy(request, {
        status: 503,
        headers: {},
      });
      assert.equal(failedOrigin.matches, false);
      assert.equal(failedOrigin.modified, true);
      assert.notEqual(failedOrigin.policy, entry);
      assert.throws(
        () => entry.revalidatedPolicy(request, undefined),
        /Response headers missing/u
      );
    }
  });
}

for (const control of [
  "ordinary-expiration",
  "public-cookie",
  "immutable-cookie",
  "private-cache-cookie",
]) {
  await test(`installed cache preserves explicitly permitted stale use for ${control}`, () => {
    const policy = new CachePolicy(
      request,
      {
        status: 200,
        headers: {
          date: new Date().toUTCString(),
          age: "1",
          "cache-control":
            stale +
            (control === "public-cookie"
              ? ", public"
              : control === "immutable-cookie"
                ? ", immutable"
                : ""),
          ...(control === "ordinary-expiration"
            ? {}
            : { "set-cookie": "synthetic-account=A" }),
        },
      },
      { shared: control !== "private-cache-cookie" }
    );
    const incoming = {
      ...request,
      headers: { ...request.headers, "cache-control": "max-stale=999999" },
    };
    assert.equal(policy.maxAge(), 0);
    assert.equal(policy.satisfiesWithoutRevalidation(incoming), true);
    assert.equal(
      policy.evaluateRequest(request).revalidation?.synchronous,
      false
    );
    assert.ok(policy.timeToLive() > 0);
    const failedOrigin = policy.revalidatedPolicy(request, {
      status: 503,
      headers: {},
    });
    assert.equal(failedOrigin.policy, policy);
    assert.equal(failedOrigin.modified, false);
  });
}
