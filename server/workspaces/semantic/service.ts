import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { semanticServiceEnvironment } from "../../../shared/environment/env/semantic";
import { SemanticSnapshotSchema, semanticLimits } from "./snapshot";
import { verifySemanticMemoryLimit } from "./memory";
import { executeSemanticProcess } from "./process";

const environment = semanticServiceEnvironment();
await verifySemanticMemoryLimit();
const token = Buffer.from(`Bearer ${environment.ZOEN_SEMANTIC_TOKEN.reveal()}`);
let active:
  | { id: string; controller: AbortController; settled: Promise<void> }
  | undefined;
const server = createServer((request, response) => {
  const authorization = Buffer.from(request.headers.authorization ?? "");
  if (
    authorization.length !== token.length ||
    !timingSafeEqual(authorization, token)
  ) {
    response.writeHead(401).end();
    return;
  }
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(204).end();
    return;
  }
  const id = z.uuid().safeParse(request.headers["x-execution-id"]);
  if (!id.success) {
    response.writeHead(400).end();
    return;
  }
  if (request.method === "POST" && request.url === "/cancel") {
    const current = active;
    if (current?.id === id.data) current.controller.abort();
    void (current?.id === id.data ? current.settled : Promise.resolve()).then(
      () => {
        response.writeHead(204).end();
      }
    );
    return;
  }
  if (request.method !== "POST" || request.url !== "/execute") {
    response.writeHead(404).end();
    return;
  }
  if (active) {
    response.writeHead(503).end();
    return;
  }
  const controller = new AbortController();
  const done = Promise.withResolvers<void>();
  const current = { id: id.data, controller, settled: done.promise };
  active = current;
  const deadline = setTimeout(() => {
    controller.abort();
  }, semanticLimits.deadlineMs);
  controller.signal.addEventListener(
    "abort",
    () => {
      if (!request.complete) request.destroy();
    },
    { once: true }
  );
  response.on("close", () => {
    if (!response.writableEnded) controller.abort();
  });
  void Promise.try(async () => {
    let bytes = 0;
    const chunks: Buffer[] = [];
    for await (const item of request) {
      const value: unknown = item;
      if (!(value instanceof Uint8Array))
        throw new Error("Invalid request bytes");
      const chunk = Buffer.from(value);
      bytes += chunk.length;
      if (bytes > semanticLimits.inputBytes) throw new Error("Input too large");
      controller.signal.throwIfAborted();
      chunks.push(chunk);
    }
    controller.signal.throwIfAborted();
    const payload = JSON.stringify(
      SemanticSnapshotSchema.parse(
        JSON.parse(Buffer.concat(chunks).toString("utf8"))
      )
    );
    const result = await executeSemanticProcess(
      payload,
      controller.signal,
      fileURLToPath(new URL("worker.cjs", import.meta.url))
    );
    controller.signal.throwIfAborted();
    response
      .writeHead(200, {
        "content-type": "application/json",
        "cache-control": "no-store",
      })
      .end(JSON.stringify(result));
  })
    .catch(() => {
      // No SQL, source contents or compiler diagnostics cross an error response.
      response.writeHead(422).end();
    })
    .finally(() => {
      clearTimeout(deadline);
      if (active === current) active = undefined;
      done.resolve();
    });
});
server.requestTimeout = semanticLimits.deadlineMs;
server.headersTimeout = 5_000;
server.keepAliveTimeout = 1_000;
server.listen(environment.ZOEN_SEMANTIC_PORT, "0.0.0.0");
process.on("SIGTERM", () => {
  active?.controller.abort();
  server.close();
});
