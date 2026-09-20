import { withSignal } from "../../operations/async";
import { z } from "zod";

import { once } from "node:events";
import { createServer, type Server } from "node:http";

import { describe, expect, it } from "vitest";
import { downloadMediaBytes } from "./download";
import { decodeMediaText } from "./policy";

function fixtureUrl(server: Server) {
  const address = z.object({ port: z.number() }).parse(server.address());
  return `http://127.0.0.1:${String(address.port)}/file`;
}

const download = downloadMediaBytes;

describe("bounded download over real loopback HTTP (no provider emulation)", () => {
  it("downloads a synthetic text file and decodes its actual bytes", async () => {
    const file = Buffer.from("Projeto orquídea: entregar terça-feira.");
    await using server = createServer((_request, response) => {
      response.end(file);
    }).listen(0, "127.0.0.1");
    await once(server, "listening");
    const bytes = await download(fixtureUrl(server), 1024);
    expect(bytes).toEqual(file);
    expect(await decodeMediaText(bytes)).toBe(file.toString("utf8"));
  });
  it("closes a rejected oversized response before buffering its body", async () => {
    let closed = Promise.resolve<unknown>(undefined);
    await using server = createServer((_request, response) => {
      closed = once(response, "close");
      response.writeHead(200, { "content-length": "1000000" });
      response.flushHeaders();
      response.write("x");
    }).listen(0, "127.0.0.1");
    await once(server, "listening");
    await expect(download(fixtureUrl(server), 16)).rejects.toMatchObject({
      reason: "too_large",
    });
    await closed;
  });
  it("enforces the stream limit when content length is absent", async () => {
    await using server = createServer((_request, response) => {
      response.writeHead(200, { "transfer-encoding": "chunked" });
      response.write(Buffer.alloc(32, 65));
      response.end();
    }).listen(0, "127.0.0.1");
    await once(server, "listening");
    await expect(download(fixtureUrl(server), 16)).rejects.toMatchObject({
      reason: "too_large",
    });
  });
  it("does not follow redirects", async () => {
    let redirectedRequests = 0;
    await using server = createServer((request, response) => {
      if (request.url === "/file")
        response.writeHead(302, { location: "/target" });
      else redirectedRequests++;
      response.end();
    }).listen(0, "127.0.0.1");
    await once(server, "listening");
    await expect(download(fixtureUrl(server), 1024)).rejects.toMatchObject({
      reason: "download_failed",
    });
    expect(redirectedRequests).toBe(0);
  });
  it("propagates caller cancellation to an unfinished HTTP response", async () => {
    const started = Promise.withResolvers<undefined>();
    const closed = Promise.withResolvers<undefined>();
    await using server = createServer((_request, response) => {
      response.once("close", () => {
        closed.resolve(undefined);
      });
      response.writeHead(200, { "transfer-encoding": "chunked" });
      response.write("partial file");
      started.resolve(undefined);
    }).listen(0, "127.0.0.1");
    await once(server, "listening");
    const controller = new AbortController();
    const interrupted = withSignal(controller.signal, () =>
      download(fixtureUrl(server), 1024)
    ).catch((error: unknown) => error);
    await started.promise;
    controller.abort();
    const result = await interrupted;
    expect(result).toBe(controller.signal.reason);
    await closed.promise;
  });
});
