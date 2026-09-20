import { InternalCallbackRejected } from "./callback-auth";
import { Secret } from "@shared/environment/secret";
import { env } from "@shared/environment/env";
import { jsonString } from "@shared/validation";

import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { resolvedInstallationSecrets } from "@db/services/installation-secrets";

import { expect, test, vi } from "vitest";
import {
  readVerifiedInternalCallback,
  internalCallbackBodies,
  internalCallbackHeaders,
  internalCallbackOrigin,
} from "./callback-auth";

vi.mock("@shared/environment/env", async (original) => {
  const actual = await original<typeof import("@shared/environment/env")>();
  return { ...actual, env: { ...actual.env } };
});
vi.mock("@db/services/installation-secrets", () => ({
  resolvedInstallationSecrets: vi.fn<typeof resolvedInstallationSecrets>(),
}));

const configuration = {
  BETTER_AUTH_URL: "http://127.0.0.1:3000",
  SECRET_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
};
const unusedBetterAuthSecret = randomBytes(32).toString("base64");
const route = "/internal/scheduled-run/report";
const body = JSON.stringify({ runId: randomUUID() });
const secretsLayer = (secretEncryptionKey: string) => ({
  betterAuthSecret: new Secret(unusedBetterAuthSecret),
  secretEncryptionKey: new Secret(secretEncryptionKey),
});
async function run<A>(
  operation: () => A | Promise<A>,
  config: Record<string, string> = configuration,
  secrets = secretsLayer(configuration.SECRET_ENCRYPTION_KEY)
) {
  Object.assign(env, { BETTER_AUTH_URL: config.BETTER_AUTH_URL });
  vi.mocked(resolvedInstallationSecrets).mockResolvedValue(secrets);
  return await operation();
}

function request(
  headers: Headers,
  payload = body,
  path = route,
  method: "POST" | "PUT" = "POST"
) {
  return new Request(`http://127.0.0.1:4274${path}`, {
    method,
    headers,
    body: payload,
  });
}

test("authenticates raw bytes through a proxy with a different internal host", async () => {
  const headers = await run(() => internalCallbackHeaders(route, body));
  const raw = await run(() =>
    readVerifiedInternalCallback(request(headers), route)
  );
  expect(raw.toString()).toBe(body);
  // The public audience is configured; forwarded headers cannot change it.
  headers.set("x-forwarded-host", "untrusted.invalid");
  expect(
    (
      await run(() => readVerifiedInternalCallback(request(headers), route))
    ).toString()
  ).toBe(body);
});

test("rejects absent, malformed and changed signatures and changed body/method/path/query", async () => {
  const headers = await run(() => internalCallbackHeaders(route, body));
  const absent = new Headers();
  const malformed = new Headers(headers);
  malformed.set("x-internal-callback-signature", "x");
  const wrong = new Headers(headers);
  wrong.set("x-internal-callback-signature", "00".repeat(32));
  const inputs = [
    request(absent),
    request(malformed),
    request(wrong),
    request(headers, `${body} `),
    request(headers, body, route, "PUT"),
    request(headers, body, `${route}?extra=1`),
    request(headers, body, "/internal/scheduled-run/respond"),
  ];
  const results = await Promise.all(
    inputs.map((input) =>
      run(() =>
        Promise.try(async () =>
          readVerifiedInternalCallback(input, route)
        ).then(
          () => {
            throw new Error("Expected rejection");
          },
          (error: unknown) => {
            if (error instanceof InternalCallbackRejected) return error;
            throw error;
          }
        )
      )
    )
  );
  for (const result of results) expect(result.status).toBe(401);
});

test("rejects a signature transplanted between routes, audiences or installations", async () => {
  const headers = await run(() => internalCallbackHeaders(route, body));
  const respond = "/internal/scheduled-run/respond";
  expect(
    await run(() =>
      Promise.try(async () =>
        readVerifiedInternalCallback(request(headers, body, respond), respond)
      ).then(
        () => {
          throw new Error("Expected rejection");
        },
        (error: unknown) => {
          if (error instanceof InternalCallbackRejected) return error;
          throw error;
        }
      )
    )
  ).toMatchObject({ status: 401 });
  expect(
    await run(
      () =>
        Promise.try(async () =>
          readVerifiedInternalCallback(request(headers), route)
        ).then(
          () => {
            throw new Error("Expected rejection");
          },
          (error: unknown) => {
            if (error instanceof InternalCallbackRejected) return error;
            throw error;
          }
        ),
      {
        ...configuration,
        BETTER_AUTH_URL: "https://another-installation.invalid",
      }
    )
  ).toMatchObject({ status: 401 });
  expect(
    await run(
      () =>
        Promise.try(async () =>
          readVerifiedInternalCallback(request(headers), route)
        ).then(
          () => {
            throw new Error("Expected rejection");
          },
          (error: unknown) => {
            if (error instanceof InternalCallbackRejected) return error;
            throw error;
          }
        ),
      configuration,
      secretsLayer(randomBytes(32).toString("base64"))
    )
  ).toMatchObject({ status: 401 });
});

test("rejects correctly signed expired and far-future requests", async () => {
  const derivedKey = createHmac(
    "sha256",
    Buffer.from(configuration.SECRET_ENCRYPTION_KEY, "base64")
  )
    .update("companion/internal-callback/v1")
    .digest();
  await Promise.all(
    [-120, 120].map(async (offset) => {
      const timestamp = String(Math.floor(Date.now() / 1000) + offset);
      const signature = createHmac("sha256", derivedKey)
        .update(
          JSON.stringify([
            "v1",
            configuration.BETTER_AUTH_URL,
            "POST",
            route,
            timestamp,
            createHash("sha256").update(body).digest("hex"),
          ])
        )
        .digest("hex");
      const headers = new Headers({
        "x-internal-callback-time": timestamp,
        "x-internal-callback-signature": signature,
      });
      expect(
        await run(() =>
          Promise.try(async () =>
            readVerifiedInternalCallback(request(headers), route)
          ).then(
            () => {
              throw new Error("Expected rejection");
            },
            (error: unknown) => {
              if (error instanceof InternalCallbackRejected) return error;
              throw error;
            }
          )
        )
      ).toMatchObject({ status: 401 });
    })
  );
});

test("requires explicit valid secret and restricts cleartext destinations to loopback", async () => {
  expect(
    await run(
      () =>
        Promise.try(async () => internalCallbackHeaders(route, body)).then(
          () => {
            throw new Error("Expected rejection");
          },
          (error: unknown) => {
            if (error instanceof InternalCallbackRejected) return error;
            throw error;
          }
        ),
      configuration,
      secretsLayer("bad-key")
    )
  ).toMatchObject({ status: 503 });
  const remoteConfigs = [
    { ...configuration, BETTER_AUTH_URL: "http://remote.invalid" },
    { ...configuration, BETTER_AUTH_URL: "https://user:password@host.invalid" },
  ];
  await Promise.all(
    remoteConfigs.map(async (config) => {
      expect(
        await run(
          () =>
            Promise.try(async () => internalCallbackHeaders(route, body)).then(
              () => {
                throw new Error("Expected rejection");
              },
              (error: unknown) => {
                if (error instanceof InternalCallbackRejected) return error;
                throw error;
              }
            ),
          config
        )
      ).toMatchObject({ status: 503 });
    })
  );
  expect(
    await run(internalCallbackOrigin, {
      ...configuration,
      BETTER_AUTH_URL: "https://host.invalid/path",
    })
  ).toBe("https://host.invalid");
});

test("limits streamed body bytes without trusting Content-Length", async () => {
  const oversized = "x".repeat(64 * 1024 + 1);
  const headers = await run(() => internalCallbackHeaders(route, oversized));
  headers.set("content-length", "1");
  expect(
    await run(() =>
      Promise.try(async () =>
        readVerifiedInternalCallback(request(headers, oversized), route)
      ).then(
        () => {
          throw new Error("Expected rejection");
        },
        (error: unknown) => {
          if (error instanceof InternalCallbackRejected) return error;
          throw error;
        }
      )
    )
  ).toMatchObject({ status: 413 });
});

test("signed malformed JSON and extra authority fields fail the boundary schema", async () => {
  await Promise.all(
    ["{", JSON.stringify({ runId: randomUUID(), userId: "other-user" })].map(
      async (payload) => {
        const headers = await run(() =>
          internalCallbackHeaders(route, payload)
        );
        const raw = await run(() =>
          readVerifiedInternalCallback(request(headers, payload), route)
        );
        const result = await run(() =>
          Promise.try(async () =>
            jsonString(internalCallbackBodies[route].strict()).parseAsync(
              raw.toString()
            )
          ).then(
            (value) => ({ ok: true as const, value }),
            (error: unknown) => ({ ok: false as const, error })
          )
        );
        expect(result).toMatchObject({ ok: false });
      }
    )
  );
});

test("a valid retry remains authentic and must still pass the database claim", async () => {
  const headers = await run(() => internalCallbackHeaders(route, body));
  const results = await Promise.all(
    [1, 2].map(() =>
      run(() => readVerifiedInternalCallback(request(headers), route))
    )
  );
  for (const result of results) expect(result.toString()).toBe(body);
});
