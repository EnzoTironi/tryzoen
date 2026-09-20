import { z } from "zod";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, vi } from "vitest";
import { env } from "@shared/environment/env";

import { acceptMatrixTransaction } from "../../server/matrix/inbound";

/** Call only after the fixture's callback listener is accepting requests. */
export async function wakeMatrixService() {
  // PostgreSQL preserves transaction IDs while this clears callback backoff
  // accumulated during builds or unrelated runtime tests.
  await promisify(execFile)(
    "docker",
    ["restart", "zoen-runtime-tests-matrix-1"],
    { timeout: 30_000 }
  );
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
    server.listen(4350, "0.0.0.0", resolve);
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
