import { z } from "zod";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream } from "node:stream/web";
import {
  withTimeout,
  mapAsync,
  operationSignal,
} from "../../server/operations/async";
import type { launchFixture } from "./fixture";
import { Client } from "eve/client";

/** A temporary loopback proxy gives synthetic evals an ordinary authenticated session. */
export async function launchTarget(
  origin: string,
  fixture: Awaited<ReturnType<typeof launchFixture>>
) {
  const token = randomBytes(32).toString("hex");
  const authorization = Buffer.from(`Bearer ${token}`);
  const lifetime = new AbortController();
  async function handle(request: IncomingMessage, outgoing: ServerResponse) {
    const supplied = Buffer.from(request.headers.authorization ?? "");
    if (
      supplied.length !== authorization.length ||
      !timingSafeEqual(supplied, authorization)
    ) {
      outgoing.writeHead(401).end();
      return;
    }
    const url = new URL(request.url ?? "/", origin);
    if (url.origin !== origin) {
      outgoing.writeHead(403).end();
      return;
    }
    const json = (value: unknown) =>
      outgoing
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify(value));
    if (request.method === "GET" && url.pathname === "/_eval/fixture") {
      json(fixture.metadata);
      return;
    }
    if (fixture.network) {
      if (request.method === "GET" && url.pathname === "/_eval/network") {
        json(await fixture.network.inspect());
        return;
      }
      if (
        request.method === "POST" &&
        url.pathname === "/_eval/network-human"
      ) {
        json(await fixture.network.direct());
        return;
      }
      if (
        request.method === "POST" &&
        url.pathname === "/_eval/network-revoke"
      ) {
        json(await fixture.network.revoke());
        return;
      }
    }
    if (request.method === "GET" && url.pathname === "/_eval/ontology") {
      json(await fixture.ontology());
      return;
    }
    if (request.method === "GET" && url.pathname === "/_eval/file") {
      json(await fixture.inspect(url.searchParams.get("path") ?? ""));
      return;
    }
    if (!url.pathname.startsWith("/eve/v1/")) {
      outgoing.writeHead(404).end();
      return;
    }
    const controller = new AbortController();
    outgoing.once("close", () => {
      controller.abort();
    });
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) {
      if (
        typeof value === "string" &&
        ![
          "authorization",
          "host",
          "content-length",
          "transfer-encoding",
        ].includes(name)
      )
        headers.set(name, value);
    }
    headers.set("accept-encoding", "identity");
    headers.set("cookie", fixture.cookie);
    headers.set("x-zoen-workspace", fixture.actor.workspaceId);
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      const bytes: Buffer = Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(z.string().parse(chunk));
      size += bytes.length;
      if (size > 1_048_576) {
        outgoing.writeHead(413).end();
        return;
      }
      chunks.push(bytes);
    }
    const response = await fetch(url, {
      method: request.method,
      headers,
      redirect: "error",
      ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
      signal: AbortSignal.any([controller.signal, lifetime.signal]),
    });
    const responseHeaders = new Headers(response.headers);
    for (const name of [
      "content-encoding",
      "content-length",
      "transfer-encoding",
    ])
      responseHeaders.delete(name);
    outgoing.writeHead(response.status, Object.fromEntries(responseHeaders));
    if (response.body)
      await pipeline(
        // Node and DOM declare different BYOB generic bounds for the same runtime stream.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        Readable.fromWeb(response.body as ReadableStream<Uint8Array>),
        outgoing
      );
    else outgoing.end();
  }
  const server = createServer((request, response) => {
    void handle(request, response).catch(() => {
      if (!response.headersSent) response.writeHead(502);
      response.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Expected a loopback TCP server.");
  return {
    token,
    url: `http://127.0.0.1:${address.port}`,
    async [Symbol.asyncDispose]() {
      lifetime.abort();
      server.closeAllConnections();
      await new Promise<void>((resolve) =>
        server.close(() => {
          resolve();
        })
      );
      const client = new Client({
        host: origin,
        redirect: "error",
        headers: {
          cookie: fixture.cookie,
          "x-zoen-workspace": fixture.actor.workspaceId,
        },
      });
      await withTimeout(async () => {
        await mapAsync(
          await fixture.sessions(),
          async ({ session_id }) => {
            const session = client.sessions.attach(session_id);
            await session.cancel({ tasks: true, signal: operationSignal() });
            await session.reset({
              reason: "Synthetic evaluation completed",
              signal: operationSignal(),
            });
          },
          2
        );
      }, 30_000);
    },
  };
}
