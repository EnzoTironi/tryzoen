import { openAsBlob } from "node:fs";
import { mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type TestContext } from "vitest";
import { inspectMemoryArchiveFile } from "@web/files/memory";
import {
  privateMemoryArchiveDownloads,
  privateMemoryArchiveLimits,
} from "../../packages/companion-ui/src/learned/schema";

// Real HTTP and filesystem-backed File transport checks. The peer supplies
// synthetic protocol responses; it is not the authenticated backend restorer.
const scope = { userId: "synthetic-owner", workspaceId: "synthetic-workspace" };
async function transport(
  context: TestContext,
  options: {
    head?: string | null;
    applyStatus?: number;
    wrongDigest?: boolean;
  } = {}
) {
  const head = options.head === undefined ? "b".repeat(40) : options.head;
  const directory = await mkdtemp(join(tmpdir(), "zoen-k3-client-transport-"));
  const requests: {
    url: URL;
    bytes: Buffer;
    contentType: string | undefined;
  }[] = [];
  const server = createServer((request, response) => {
    void Promise.try(async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        const value: unknown = chunk;
        if (!(value instanceof Uint8Array))
          throw new Error("Expected HTTP binary bytes.");
        chunks.push(Buffer.from(value));
      }
      const bytes = Buffer.concat(chunks);
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      requests.push({
        url,
        bytes,
        contentType: request.headers["content-type"],
      });
      if (url.searchParams.get("mode") === "inspect") {
        response.writeHead(200, { "content-type": "application/json" }).end(
          JSON.stringify({
            version: 3,
            coverage: "complete-journal",
            capturedThrough: null,
            namespaceId: "00000000-0000-4000-8000-000000000001",
            scope,
            revision: null,
            expectedRevision: head,
            archiveDigest: options.wrongDigest
              ? "f".repeat(64)
              : createHash("sha256").update(bytes).digest("hex"),
            claimCount: 0,
            sourceEvents: 0,
            sourceBytes: 0,
            retainedHistory: true,
          })
        );
      } else
        response
          .writeHead(options.applyStatus ?? 200, {
            "content-type": "application/json",
          })
          .end(JSON.stringify({ applied: false, revision: head }));
    }).catch((error: unknown) => {
      response
        .writeHead(500)
        .end(
          error instanceof Error ? error.message : "Transport fixture failed"
        );
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Expected a loopback TCP listener.");
  context.onTestFinished(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      })
    );
    await rm(directory, { recursive: true, force: true });
  });
  async function file(
    name: string = privateMemoryArchiveDownloads["complete-journal"].filename,
    size?: number
  ) {
    const path = join(directory, name);
    await writeFile(path, "synthetic framed-archive transport bytes");
    if (size !== undefined) await truncate(path, size);
    return new File([await openAsBlob(path)], name);
  }
  return { origin: `http://127.0.0.1:${address.port}`, requests, file, head };
}

test("inspect and explicit apply send identical file bytes with the reviewed digest and head over real HTTP", async (context) => {
  const peer = await transport(context);
  const selected = await peer.file();
  const original = Buffer.from(await selected.arrayBuffer());
  const review = await inspectMemoryArchiveFile(
    peer.origin,
    selected,
    "workspace-selection"
  );
  expect(peer.requests).toHaveLength(1);
  await expect(review.apply()).resolves.toEqual({
    applied: false,
    revision: peer.head,
  });
  const inspected = peer.requests[0];
  const applied = peer.requests[1];
  expect(inspected?.url.searchParams.get("mode")).toBe("inspect");
  expect(applied?.url.searchParams.get("mode")).toBe("apply");
  expect(applied?.url.searchParams.get("space")).toBe("workspace-selection");
  expect(applied?.url.searchParams.get("expectedRevision")).toBe(
    review.preview.expectedRevision
  );
  expect(applied?.url.searchParams.get("archiveDigest")).toBe(
    createHash("sha256").update(original).digest("hex")
  );
  expect(inspected?.bytes).toEqual(original);
  expect(applied?.bytes).toEqual(original);
  expect(applied?.contentType).toBe(
    privateMemoryArchiveDownloads["complete-journal"].contentType
  );
  await review.dispose();
});

test("empty reviewed head is explicit and disposing prevents another HTTP request", async (context) => {
  const peer = await transport(context, { head: null });
  const review = await inspectMemoryArchiveFile(peer.origin, await peer.file());
  await review.apply();
  expect(peer.requests[1]?.url.searchParams.has("expectedRevision")).toBe(true);
  expect(peer.requests[1]?.url.searchParams.get("expectedRevision")).toBe("");
  await review.dispose();
  await expect(review.apply()).rejects.toThrow("inspect the archive again");
  expect(peer.requests).toHaveLength(2);
});

test("the client refuses a protocol peer digest mismatch", async (context) => {
  const peer = await transport(context, { wrongDigest: true });
  await expect(
    inspectMemoryArchiveFile(peer.origin, await peer.file())
  ).rejects.toThrow("hash does not match");
  expect(peer.requests).toHaveLength(1);
});

test("legacy and oversized actual file selections are refused without transmitting bytes", async (context) => {
  const peer = await transport(context);
  await expect(
    inspectMemoryArchiveFile(peer.origin, await peer.file("old-memory.zip"))
  ).rejects.toThrow("Legacy ZIP");
  const oversized = await peer.file(
    "too-large.zoen-memory",
    privateMemoryArchiveLimits.wireBytes + 1
  );
  expect(oversized.size).toBeGreaterThan(privateMemoryArchiveLimits.wireBytes);
  await expect(
    inspectMemoryArchiveFile(peer.origin, oversized)
  ).rejects.toThrow("size limit");
  expect(peer.requests).toHaveLength(0);
});

test("real HTTP 409 retains the inspected head and file rather than silently rebasing", async (context) => {
  const peer = await transport(context, { applyStatus: 409 });
  const selected = await peer.file();
  const review = await inspectMemoryArchiveFile(peer.origin, selected);
  await expect(review.apply()).rejects.toThrow("conflicts with current memory");
  await expect(review.apply()).rejects.toThrow("conflicts with current memory");
  expect(peer.requests).toHaveLength(3);
  for (const request of peer.requests.slice(1)) {
    expect(request.url.searchParams.get("expectedRevision")).toBe(peer.head);
    expect(request.bytes).toEqual(peer.requests[0]?.bytes);
  }
  await review.dispose();
});
