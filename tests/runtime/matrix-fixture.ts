import { z } from "zod";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, vi } from "vitest";
import { env } from "@shared/environment/env";

import { acceptMatrixTransaction } from "../../server/matrix/inbound";
import { requireRuntimeDatabase } from "./database";

// Every installation must select its leased callback explicitly.
export const matrixCallbackPort = z.coerce
  .number()
  .int()
  .min(1)
  .max(65535)
  .parse(process.env.ZOEN_RUNTIME_MATRIX_CALLBACK_PORT);

/** Call only after the fixture's callback listener is accepting requests. */
export async function wakeMatrixService() {
  await requireRuntimeDatabase();
  const databaseContainer = z
    .string()
    .regex(/^zoen-[a-z0-9-]+-postgres-1$/)
    .parse(process.env.ZOEN_RESTORE_TEST_CONTAINER);
  const container = z
    .literal(databaseContainer.replace(/-postgres-1$/, "-matrix-1"))
    .parse(
      process.env.ZOEN_RUNTIME_MATRIX_CONTAINER ??
        databaseContainer.replace(/-postgres-1$/, "-matrix-1")
    );
  const origin = new URL(z.string().parse(env.ZOEN_MATRIX_URL));
  const { stdout } = await promisify(execFile)(
    "docker",
    ["inspect", "--format", "{{json .NetworkSettings.Ports}}", container],
    { timeout: 5_000 }
  );
  const ports = z
    .object({
      "8008/tcp": z.array(
        z.object({ HostIp: z.string(), HostPort: z.string() })
      ),
    })
    .parse(JSON.parse(stdout));
  expect(["localhost", "127.0.0.1", "[::1]"]).toContain(origin.hostname);
  expect(ports["8008/tcp"]).toContainEqual({
    HostIp: origin.hostname === "localhost" ? "127.0.0.1" : origin.hostname,
    HostPort: origin.port,
  });
  // PostgreSQL preserves transaction IDs while this clears callback backoff
  // accumulated during builds or unrelated runtime tests.
  await promisify(execFile)("docker", ["restart", container], {
    timeout: 30_000,
  });
  await vi.waitFor(
    async () => {
      const response = await fetch(
        new URL(
          "/_matrix/client/versions",
          z.string().parse(env.ZOEN_MATRIX_URL)
        )
      );
      expect(response.ok).toBe(true);
    },
    { timeout: 20_000, interval: 100 }
  );
}

export async function matrixReceiver() {
  const receipts: { id: string; body: string; authorization: string }[] = [];
  const server = createServer((incoming, outgoing) => {
    const receive = async () => {
      if (!incoming.url?.startsWith("/_matrix/app/v1/transactions/")) {
        outgoing.writeHead(200);
        outgoing.end("{}");
        return;
      }
      try {
        const chunks: Uint8Array[] = [];
        for await (const chunk of incoming)
          chunks.push(z.instanceof(Uint8Array).parse(chunk));
        const body = Buffer.concat(chunks).toString("utf8");
        const authorization = incoming.headers.authorization ?? "";
        const id = incoming.url.split("/").at(-1) ?? "";
        await acceptMatrixTransaction(
          new Request("http://localhost/transactions", {
            method: "PUT",
            headers: { authorization },
            body,
          }),
          id
        );
        receipts.push({ id, body, authorization });
        outgoing.writeHead(200);
        outgoing.end("{}");
      } catch {
        outgoing.writeHead(503);
        outgoing.end("{}");
      }
    };
    void receive();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(matrixCallbackPort, "0.0.0.0", resolve);
  });
  try {
    await wakeMatrixService();
  } catch (error) {
    server.close();
    throw error;
  }
  return {
    receipts,
    close: () =>
      new Promise<void>((resolve) =>
        server.close(() => {
          resolve();
        })
      ),
  };
}
