import { createHmac, randomUUID } from "node:crypto";
import { createServer, request as upstreamRequest } from "node:http";
import type { Socket } from "node:net";
import { sql } from "drizzle-orm";
import { afterEach, expect, test, vi } from "vitest";
import { z } from "zod";
import { query, transaction, SqlError } from "@db/queries";
import { getInstallationSecrets } from "@db/services/installation-secrets";
import {
  finalizeBrowserImageArtifact,
  readReadyBrowserImageArtifact,
  reserveBrowserImageArtifact,
} from "@db/services/browser-images";
import { env } from "@shared/environment";
import { maximumBrowserImageBytes } from "@shared/browser/artifact";
import { GET } from "@app/artifacts/[artifactId]/route";
import { workspaceFixture } from "./workspace-fixture";
import { corruptPayload } from "./payload-corruption";
import { openPayloads } from "../../server/payloads/connection";
import { PayloadReferenceSchema } from "../../server/payloads/contract";
import { operationSignal } from "../../server/operations/async";
import { queuePayloadErasure } from "../../server/payloads/erasure";
import { WorkspaceAccessDenied } from "../../server/workspaces/access";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/O9sAAAAASUVORK5CYII=",
  "base64"
);
const workspaces = new Set<string>();
const owners = new Set<string>();
const capture = () => ({
  browserSessionId: randomUUID(),
  idempotencyKey: randomUUID(),
  label: "Synthetic browser image",
  rootSessionId: randomUUID(),
  sourceKind: "viewport",
  workerSessionId: randomUUID(),
});

async function fixture() {
  const workspace = await workspaceFixture();
  owners.add(workspace.actor.userId);
  workspaces.add(workspace.actor.workspaceId);
  workspaces.add(workspace.personal.workspaceId);
  return workspace;
}

async function publish(
  scope: Awaited<ReturnType<typeof workspaceFixture>>["actor"],
  input = capture()
) {
  const reserved = await reserveBrowserImageArtifact(scope, input);
  if (reserved.status !== "pending")
    throw new Error("Expected a pending image");
  const result = await finalizeBrowserImageArtifact(
    scope,
    reserved.reservation,
    {
      bytes: png,
      filename: "synthetic.png",
      sourceKind: input.sourceKind,
    }
  );
  return { ...result, input, reservation: reserved.reservation };
}

async function payload(id: string) {
  const [row] =
    await query(sql`SELECT p.id AS "candidateId",p.workspace_id AS "workspaceId",
    p.owner_generation AS "ownerGeneration",p.owner_user_id AS "ownerUserId",p.kind,p.sha256,p.byte_length AS "byteLength"
    FROM payload_object p JOIN browser_image_artifacts b ON b.payload_object_id=p.id WHERE b.id=${id}`);
  return PayloadReferenceSchema.parse(row);
}

async function imageRequest(id: string, token?: string, etag?: string) {
  const headers = new Headers();
  if (token) {
    const { betterAuthSecret } = await getInstallationSecrets();
    const signature = createHmac("sha256", betterAuthSecret)
      .update(token)
      .digest("base64");
    headers.set(
      "cookie",
      `better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}`
    );
  }
  if (etag) headers.set("if-none-match", etag);
  return GET(
    new Request(`http://localhost:3000/artifacts/${id}`, { headers }),
    {
      params: Promise.resolve({ artifactId: id }),
    }
  );
}

afterEach(async () => {
  vi.unstubAllEnvs();
  const connection = openPayloads();
  try {
    for (const workspaceId of workspaces) {
      const rows =
        await query(sql`SELECT id AS "candidateId",workspace_id AS "workspaceId",
        owner_generation AS "ownerGeneration",owner_user_id AS "ownerUserId",kind,sha256,byte_length AS "byteLength"
        FROM payload_object WHERE workspace_id=${workspaceId} AND kind='browser-image'`);
      for (const row of rows)
        await connection.payloads.removeExact({
          reference: PayloadReferenceSchema.parse(row),
          signal: operationSignal(),
          deadlineMs: Date.now() + 5_000,
        });
    }
  } finally {
    connection.close();
    for (const owner of owners)
      await query(sql`UPDATE payload_erasure SET available_at=clock_timestamp()+interval '1 day'
        WHERE owner_user_id=${owner}`);
    owners.clear();
    workspaces.clear();
  }
});

test.each(["personal", "actor"] as const)(
  "publishes real R2 bytes and stable retries in the %s workspace without Blob configuration",
  async (kind) => {
    await using workspace = await fixture();
    expect(env.BLOB_READ_WRITE_TOKEN).toBeUndefined();
    const scope = workspace[kind];
    const input = capture();
    const initial = await reserveBrowserImageArtifact(scope, input);
    expect(await reserveBrowserImageArtifact(scope, input)).toEqual(initial);
    const result = await publish(scope, input);
    expect(await reserveBrowserImageArtifact(scope, input)).toEqual({
      image: result.image,
      status: "ready",
    });
    expect(
      await finalizeBrowserImageArtifact(scope, result.reservation, {
        bytes: png,
        filename: "losing.png",
        sourceKind: "element",
      })
    ).toEqual({ image: result.image });
    const read = await readReadyBrowserImageArtifact(scope, result.image.id, {
      rootSessionId: input.rootSessionId,
    });
    expect(Buffer.from(read?.bytes ?? [])).toEqual(png);
    expect(read?.createdAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u
    );
    expect(await payload(result.image.id)).toMatchObject({
      kind: "browser-image",
      ownerUserId: scope.userId,
      ownerGeneration: result.image.id,
    });
    await expect(
      reserveBrowserImageArtifact(scope, {
        ...input,
        workerSessionId: randomUUID(),
      })
    ).rejects.toThrow("idempotency key is already in use");
  }
);

test("web authentication reads its own company image and hides foreign, missing, unauthenticated and revoked images identically", async () => {
  await using workspace = await fixture();
  const { image, input } = await publish(workspace.actor);
  const response = await imageRequest(image.id, workspace.actor.authSessionId);
  expect(response.status).toBe(200);
  expect(Buffer.from(await response.arrayBuffer())).toEqual(png);
  expect(response.headers.get("content-type")).toBe("image/png");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  const etag = z.string().parse(response.headers.get("etag"));
  expect(
    (await imageRequest(image.id, workspace.actor.authSessionId, etag)).status
  ).toBe(304);
  expect(
    await readReadyBrowserImageArtifact(workspace.guest, image.id)
  ).toBeUndefined();
  expect(
    await readReadyBrowserImageArtifact(workspace.personal, image.id)
  ).toBeUndefined();
  expect(
    await readReadyBrowserImageArtifact(workspace.actor, image.id, {
      rootSessionId: randomUUID(),
    })
  ).toBeUndefined();
  expect(
    await readReadyBrowserImageArtifact(workspace.actor, image.id, {
      rootSessionId: input.rootSessionId,
    })
  ).toBeDefined();
  await query(
    sql`DELETE FROM organization_memberships WHERE user_id=${workspace.actor.userId}`
  );
  for (const [id, token] of [
    [image.id, undefined],
    [image.id, workspace.guest.authSessionId],
    [randomUUID(), workspace.actor.authSessionId],
    [image.id, workspace.actor.authSessionId],
  ]) {
    const unavailable = await imageRequest(z.string().parse(id), token, etag);
    expect(unavailable.status).toBe(404);
    expect(await unavailable.text()).toBe("Not found");
    expect(unavailable.headers.get("cache-control")).toBe("private, no-store");
  }
});

test("persists an element fallback and replays the original image-resource request", async () => {
  await using workspace = await fixture();
  const input = { ...capture(), sourceKind: "image_resource" };
  const reserved = await reserveBrowserImageArtifact(workspace.actor, input);
  if (reserved.status !== "pending")
    throw new Error("Expected a pending image");
  const result = await finalizeBrowserImageArtifact(
    workspace.actor,
    reserved.reservation,
    {
      bytes: png,
      filename: "element.png",
      sourceKind: "element",
    }
  );
  expect(
    (await readReadyBrowserImageArtifact(workspace.actor, result.image.id))
      ?.sourceKind
  ).toBe("element");
  expect(await reserveBrowserImageArtifact(workspace.actor, input)).toEqual({
    image: result.image,
    status: "ready",
  });
});

test("concurrent publishers keep one verified canonical winner", async () => {
  await using workspace = await fixture();
  const reserved = await reserveBrowserImageArtifact(
    workspace.actor,
    capture()
  );
  if (reserved.status !== "pending")
    throw new Error("Expected a pending image");
  const results = await Promise.all(
    ["first.png", "second.png"].map((filename) =>
      finalizeBrowserImageArtifact(workspace.actor, reserved.reservation, {
        bytes: png,
        filename,
        sourceKind: "viewport",
      })
    )
  );
  expect(results[0]).toEqual(results[1]);
  const rows =
    await query(sql`SELECT state,count(*)::integer AS count FROM payload_object
    WHERE owner_generation=${reserved.reservation.id} GROUP BY state`);
  expect(rows.find((row) => row.state === "adopted")?.count).toBe(1);
  expect(
    rows.every((row) => row.state === "adopted" || row.state === "pending")
  ).toBe(true);
  expect(
    Buffer.from(
      (
        await readReadyBrowserImageArtifact(
          workspace.actor,
          reserved.reservation.id
        )
      )?.bytes ?? []
    )
  ).toEqual(png);
});

test("rejects invalid or oversized content and publication by another creator", async () => {
  await using workspace = await fixture();
  const reserved = await reserveBrowserImageArtifact(
    workspace.actor,
    capture()
  );
  if (reserved.status !== "pending")
    throw new Error("Expected a pending image");
  const oversized = new Uint8Array(maximumBrowserImageBytes + 1);
  oversized.set(png);
  for (const bytes of [
    new Uint8Array(),
    new TextEncoder().encode("not an image"),
    oversized,
  ])
    await expect(
      finalizeBrowserImageArtifact(workspace.actor, reserved.reservation, {
        bytes,
        filename: "invalid.png",
        sourceKind: "viewport",
      })
    ).rejects.toMatchObject({ reason: "invalid" });
  await expect(
    finalizeBrowserImageArtifact(workspace.guest, reserved.reservation, {
      bytes: png,
      filename: "foreign.png",
      sourceKind: "viewport",
    })
  ).rejects.toThrow("reservation is no longer available");
  expect(
    await readReadyBrowserImageArtifact(
      workspace.actor,
      reserved.reservation.id
    )
  ).toBeUndefined();
});

test("detects provider byte corruption before returning an image", async () => {
  await using workspace = await fixture();
  const { image } = await publish(workspace.personal);
  const reference = await payload(image.id);
  const changed = Buffer.from(png);
  changed[changed.length - 1] = (changed[changed.length - 1] ?? 0) ^ 1;
  await corruptPayload(reference.candidateId, changed);
  await expect(
    readReadyBrowserImageArtifact(workspace.personal, image.id)
  ).rejects.toMatchObject({ reason: "corrupt" });
  await expect(
    imageRequest(image.id, workspace.actor.authSessionId)
  ).rejects.toMatchObject({ reason: "corrupt" });
});

test("requires the canonical payload pointer, integrity metadata and creator in PostgreSQL", async () => {
  await using workspace = await fixture();
  const { image } = await publish(workspace.actor);
  const reference = await payload(image.id);
  for (const statement of [
    sql`UPDATE browser_image_artifacts SET payload_object_id=NULL WHERE id=${image.id}`,
    sql`UPDATE browser_image_artifacts SET content_hash=${"a".repeat(64)} WHERE id=${image.id}`,
    sql`UPDATE browser_image_artifacts SET created_by_user_id=${workspace.guest.userId} WHERE id=${image.id}`,
    sql`UPDATE payload_object SET state='deleting' WHERE id=${reference.candidateId}`,
    sql`DELETE FROM payload_object WHERE id=${reference.candidateId}`,
  ])
    await expect(transaction(() => query(statement))).rejects.toThrow(
      "database operation failed"
    );
  await query(sql`DELETE FROM browser_image_artifacts WHERE id=${image.id}`);
  expect(
    await query(sql`SELECT retired_at IS NOT NULL AS retired,payload_is_referenced(id) AS referenced
    FROM payload_object WHERE id=${reference.candidateId}`)
  ).toEqual([{ retired: true, referenced: false }]);
});

/** Hold only the real synthetic PUT response; no production publication boundary is mocked. */
async function heldUpload() {
  if (
    env.ZOEN_PAYLOAD_ENDPOINT !== "http://127.0.0.1:19480" ||
    !env.ZOEN_PAYLOAD_BUCKET?.startsWith("synthetic-")
  )
    throw new Error("Upload races require owned loopback storage");
  const observed = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const sockets = new Set<Socket>();
  const proxy = createServer((incoming, outgoing) => {
    const upstream = upstreamRequest(
      new URL(incoming.url ?? "/", "http://127.0.0.1:19480"),
      {
        method: incoming.method,
        headers: incoming.headers,
      },
      (response) => {
        if (incoming.method === "PUT") {
          response.resume();
          response.on("end", () => {
            observed.resolve();
            void release.promise.then(() => {
              outgoing.writeHead(response.statusCode ?? 502, response.headers);
              outgoing.end();
            });
          });
        } else {
          outgoing.writeHead(response.statusCode ?? 502, response.headers);
          response.pipe(outgoing);
        }
      }
    );
    upstream.on("error", () => outgoing.destroy());
    incoming.on("aborted", () => upstream.destroy());
    outgoing.on("close", () => upstream.destroy());
    incoming.pipe(upstream);
  });
  proxy.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve, reject) => {
    proxy.once("error", reject);
    proxy.listen(0, "127.0.0.1", resolve);
  });
  const address = proxy.address();
  if (!address || typeof address === "string")
    throw new Error("Missing owned proxy address");
  vi.stubEnv("ZOEN_PAYLOAD_ENDPOINT", `http://127.0.0.1:${address.port}`);
  return {
    observed: observed.promise,
    release: () => {
      release.resolve();
    },
    async [Symbol.asyncDispose]() {
      release.resolve();
      vi.unstubAllEnvs();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) =>
        proxy.close((error) => {
          if (error) reject(error);
          else resolve();
        })
      );
    },
  };
}

test.each(["membership", "erasure"] as const)(
  "does not adopt uploaded bytes after the creator's %s is revoked",
  async (reason) => {
    await using workspace = await fixture();
    const reserved = await reserveBrowserImageArtifact(
      workspace.actor,
      capture()
    );
    if (reserved.status !== "pending")
      throw new Error("Expected a pending image");
    await using upload = await heldUpload();
    const pending = finalizeBrowserImageArtifact(
      workspace.actor,
      reserved.reservation,
      {
        bytes: png,
        filename: "revoked.png",
        sourceKind: "viewport",
      }
    ).catch((error: unknown) => error);
    await upload.observed;
    if (reason === "membership")
      await query(
        sql`DELETE FROM organization_memberships WHERE user_id=${workspace.actor.userId}`
      );
    else
      await transaction(async () => {
        const requestId = randomUUID();
        await query(sql`INSERT INTO account_deletion_requests(id,user_id,status,completed_at,backup_expires_at)
          VALUES (${requestId},${workspace.actor.userId},'pending_external',clock_timestamp(),clock_timestamp()+interval '30 days')`);
        await query(sql`INSERT INTO account_deletion_tombstones(user_id,request_id)
          VALUES (${workspace.actor.userId},${requestId})`);
        await queuePayloadErasure({
          kind: "account",
          ownerUserId: workspace.actor.userId,
        });
      });
    upload.release();
    expect(await pending).toBeInstanceOf(
      reason === "membership" ? WorkspaceAccessDenied : SqlError
    );
    expect(
      await query(
        sql`SELECT status,payload_object_id FROM browser_image_artifacts WHERE id=${reserved.reservation.id}`
      )
    ).toEqual([{ status: "pending", payload_object_id: null }]);
    expect(
      await query(
        sql`SELECT state FROM payload_object WHERE owner_generation=${reserved.reservation.id}`
      )
    ).toEqual([{ state: "pending" }]);
    await expect(
      finalizeBrowserImageArtifact(workspace.actor, reserved.reservation, {
        bytes: png,
        filename: "late.png",
        sourceKind: "viewport",
      })
    ).rejects.toBeInstanceOf(
      reason === "membership" ? WorkspaceAccessDenied : SqlError
    );
  }
);
