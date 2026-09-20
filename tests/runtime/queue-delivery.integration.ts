import { env } from "@shared/environment/env";
import { Secret } from "@shared/environment/secret";
import { withTimeout } from "../../server/operations/async";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { createWorld } from "@workflow/world-postgres";
import { expect, test, vi } from "vitest";
test("the restricted role delivers a real queued job through the native leased worker", async () => {
  const connectionString = new Secret(env.DATABASE_URL).reveal();
  const world = createWorld({
    connectionString,
    maxPoolSize: 5,
    queueConcurrency: 1,
    namespace: "roleproof",
    jobPrefix: "roleproof_",
    applicationManagedShutdown: true,
  });
  const received = Promise.withResolvers<unknown>();
  const handle = world.createQueueHandler(
    "__roleproof_wkf_workflow_",
    async (message) => {
      received.resolve(message);
    }
  );
  const server = createServer((request, response) => {
    const run = async () => {
      const chunks: Uint8Array[] = [];
      for await (const chunk of request)
        chunks.push(z.instanceof(Uint8Array).parse(chunk));
      const headers = new Headers();
      for (const [name, value] of Object.entries(request.headers)) {
        if (value !== undefined)
          headers.set(name, Array.isArray(value) ? value.join(", ") : value);
      }
      const result = await handle(
        new Request("http://localhost/queue", {
          method: "POST",
          headers,
          body: Buffer.concat(chunks).toString("utf8"),
        })
      );
      response.writeHead(result.status);
      response.end(await result.text());
    };
    void run().catch(() => {
      received.reject(new Error("Native queue HTTP delivery failed"));
      response.writeHead(500);
      response.end();
    });
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    const port = z
      .object({
        port: z.number(),
      })
      .parse(address).port;
    vi.stubEnv("WORKFLOW_LOCAL_BASE_URL", `http://127.0.0.1:${String(port)}`);
    const payload = {
      __healthCheck: true as const,
      correlationId: randomUUID(),
    };
    await world.queue("__roleproof_wkf_workflow_probe", payload);
    expect(
      await withTimeout(async () => {
        return await received.promise;
      }, 15000)
    ).toEqual(payload);
  } finally {
    await world.close?.();
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
    vi.unstubAllEnvs();
  }
});
