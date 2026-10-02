import { randomUUID } from "node:crypto";
import { createServer, request } from "node:http";
import { sql } from "drizzle-orm";
import { expect, test } from "vitest";
import { z } from "zod";
import { query } from "@db/queries";
import { env } from "@shared/environment/env";
import { matrixConfiguration, MatrixError } from "../../server/matrix/client";
import { matrixIdentityForUser } from "../../server/matrix/identities";
import { changeMatrixGroupMembership } from "../../server/matrix/membership";
import { ensureMatrixParticipation } from "../../server/matrix/participation";
import {
  createMatrixRoom,
  requireJoinedMatrixRoom,
} from "../../server/matrix/rooms";
import { WorkspaceAccessDenied } from "../../server/workspaces/access";
import { removeWorkspaceMember } from "../../server/workspaces/team";
import { workspaceFixture } from "./workspace-fixture";

async function matrixProxy() {
  const config = await matrixConfiguration();
  const upstream = new URL(config.url);
  if (
    upstream.protocol !== "http:" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(upstream.hostname)
  )
    throw new Error("This proof requires an isolated loopback Synapse.");
  let interception:
    | {
        kind: "join";
        path: string;
        matrixId: string;
        receipt: ReturnType<typeof Promise.withResolvers<number>>;
      }
    | {
        kind: "drop-state";
        path: string;
        receipt: ReturnType<typeof Promise.withResolvers<number>>;
      }
    | {
        kind: "hold-state";
        path: string;
        receipt: ReturnType<typeof Promise.withResolvers<number>>;
        release: ReturnType<typeof Promise.withResolvers<void>>;
      }
    | undefined;
  const server = createServer((incoming, downstream) => {
    const target = new URL(incoming.url ?? "/", upstream);
    const forwarded = request(
      target,
      {
        method: incoming.method,
        headers: { ...incoming.headers, host: upstream.host },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("error", () => downstream.destroy());
        response.on("end", () => {
          void Promise.try(async () => {
            const body = Buffer.concat(chunks);
            const status = response.statusCode ?? 502;
            const fault = interception;
            if (
              fault &&
              incoming.method === (fault.kind === "join" ? "POST" : "GET") &&
              target.pathname === fault.path &&
              (fault.kind !== "join" ||
                target.searchParams.get("user_id") === fault.matrixId) &&
              status >= 200 &&
              status < 300
            ) {
              interception = undefined;
              // Synapse completed its response. Only the client's acknowledgment
              // is lost or delayed; native state is checked independently below.
              fault.receipt.resolve(status);
              if (fault.kind !== "hold-state") {
                downstream.destroy();
                return;
              }
              await fault.release.promise;
            }
            downstream.writeHead(status, {
              "content-type":
                response.headers["content-type"] ?? "application/json",
              "content-length": body.length,
            });
            downstream.end(body);
          }).catch(() => downstream.destroy());
        });
      }
    );
    forwarded.on("error", () => downstream.destroy());
    incoming.pipe(forwarded);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Expected a loopback proxy port.");
  const origin = `http://127.0.0.1:${address.port}`;
  if (!Reflect.set(env, "ZOEN_MATRIX_URL", origin))
    throw new Error("Cannot configure the Matrix forwarding proxy.");
  expect(env.ZOEN_MATRIX_URL).toBe(origin);
  return {
    dropJoin(roomId: string, matrixId: string) {
      const receipt = Promise.withResolvers<number>();
      interception = {
        kind: "join",
        path: `/_matrix/client/v3/join/${encodeURIComponent(roomId)}`,
        matrixId,
        receipt,
      };
      return receipt.promise;
    },
    dropMembership(roomId: string, matrixId: string) {
      const receipt = Promise.withResolvers<number>();
      interception = {
        kind: "drop-state",
        path: `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/m.room.member/${encodeURIComponent(matrixId)}`,
        receipt,
      };
      return receipt.promise;
    },
    holdMembership(roomId: string, matrixId: string) {
      const receipt = Promise.withResolvers<number>();
      const release = Promise.withResolvers<void>();
      interception = {
        kind: "hold-state",
        path: `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/m.room.member/${encodeURIComponent(matrixId)}`,
        receipt,
        release,
      };
      return { received: receipt.promise, release: () => release.resolve() };
    },
    async nativeMembership(roomId: string, matrixId: string) {
      const response = await fetch(
        new URL(
          `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/m.room.member/${encodeURIComponent(matrixId)}`,
          upstream
        ),
        { headers: { authorization: `Bearer ${config.token.reveal()}` } }
      );
      expect(response.status).toBe(200);
      return z.object({ membership: z.string() }).parse(await response.json())
        .membership;
    },
    async [Symbol.asyncDispose]() {
      Reflect.set(env, "ZOEN_MATRIX_URL", config.url);
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

async function bounded<Value>(promise: Promise<Value>) {
  const expired = Promise.withResolvers<never>();
  const timeout = setTimeout(
    () => expired.reject(new Error("Matrix proof barrier timed out.")),
    5000
  );
  return Promise.race([promise, expired.promise]).finally(() =>
    clearTimeout(timeout)
  );
}

async function pendingParticipant(
  proxy: Awaited<ReturnType<typeof matrixProxy>>
) {
  const resources = new AsyncDisposableStack();
  const fixture = resources.use(await workspaceFixture());
  resources.defer(() =>
    query(
      sql`DELETE FROM matrix_identities WHERE user_id = ${fixture.guest.userId}`
    ).then(() => undefined)
  );
  try {
    const username = `g${randomUUID().replaceAll("-", "").slice(0, 20)}`;
    await query(
      sql`INSERT INTO user_directory(user_id, username) VALUES (${fixture.guest.userId.slice("better-auth:".length)}, ${username})`
    );
    const room = await createMatrixRoom(fixture.actor, {
      operationId: randomUUID(),
      name: "Synthetic lost join acknowledgment",
    });
    const config = await matrixConfiguration();
    const { matrixId } = matrixIdentityForUser(
      fixture.guest.userId,
      config.serverName
    );
    const committed = proxy.dropJoin(room.roomId, matrixId);
    expect(
      await ensureMatrixParticipation(fixture.guest, room.id)
    ).toMatchObject({ status: "pending", id: room.id });
    expect(await bounded(committed)).toBe(200);
    expect(await proxy.nativeMembership(room.roomId, matrixId)).toBe("join");
    const membership = () =>
      query(sql`SELECT state, native_pending FROM matrix_room_members
        WHERE binding_id = ${room.id} AND user_id = ${fixture.guest.userId}`);
    expect(await membership()).toEqual([
      { state: "joined", native_pending: true },
    ]);
    await expect(
      requireJoinedMatrixRoom(fixture.guest, room.id)
    ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
    return {
      ...fixture,
      room,
      matrixId,
      username,
      membership,
      [Symbol.asyncDispose]: () => resources.disposeAsync(),
    };
  } catch (error) {
    await resources.disposeAsync();
    throw error;
  }
}

test(
  "manager add reconciles a real native join whose acknowledgment was lost",
  { timeout: 60000 },
  async () => {
    await using proxy = await matrixProxy();
    await using fixture = await pendingParticipant(proxy);
    const input = { id: fixture.room.id, username: fixture.username };
    expect(
      await changeMatrixGroupMembership(fixture.actor, {
        ...input,
        action: "add",
      })
    ).toEqual({ nativePending: false });
    expect(
      await proxy.nativeMembership(fixture.room.roomId, fixture.matrixId)
    ).toBe("join");
    expect(await fixture.membership()).toEqual([
      { state: "joined", native_pending: false },
    ]);
    await expect(
      requireJoinedMatrixRoom(fixture.guest, fixture.room.id)
    ).resolves.toMatchObject({ matrixId: fixture.matrixId });
    const snapshot = () =>
      query(sql`SELECT m.joined_at, b.epoch FROM matrix_room_members m
        JOIN workspace_group_bindings b ON b.id = m.binding_id
        WHERE m.binding_id = ${fixture.room.id} AND m.user_id = ${fixture.guest.userId}`);
    const confirmed = await snapshot();
    expect(
      await changeMatrixGroupMembership(fixture.actor, {
        ...input,
        action: "add",
      })
    ).toEqual({ nativePending: false });
    expect(await snapshot()).toEqual(confirmed);
  }
);

test(
  "an unavailable exact native GET leaves the staged join pending",
  { timeout: 60000 },
  async () => {
    await using proxy = await matrixProxy();
    await using fixture = await pendingParticipant(proxy);
    const dropped = proxy.dropMembership(fixture.room.roomId, fixture.matrixId);
    await expect(
      changeMatrixGroupMembership(fixture.actor, {
        id: fixture.room.id,
        action: "add",
        username: fixture.username,
      })
    ).rejects.toMatchObject(new MatrixError({ reason: "unavailable" }));
    expect(await bounded(dropped)).toBe(200);
    expect(
      await proxy.nativeMembership(fixture.room.roomId, fixture.matrixId)
    ).toBe("join");
    expect(await fixture.membership()).toEqual([
      { state: "joined", native_pending: true },
    ]);
    await expect(
      requireJoinedMatrixRoom(fixture.guest, fixture.room.id)
    ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  }
);

test(
  "a concurrent room removal waits for add reconciliation and remains authoritative",
  { timeout: 60000 },
  async () => {
    await using proxy = await matrixProxy();
    await using fixture = await pendingParticipant(proxy);
    const gate = proxy.holdMembership(fixture.room.roomId, fixture.matrixId);
    const addition = changeMatrixGroupMembership(fixture.actor, {
      id: fixture.room.id,
      action: "add",
      username: fixture.username,
    });
    let removal: ReturnType<typeof changeMatrixGroupMembership> | undefined;
    const settledAddition = Promise.allSettled([addition]);
    try {
      expect(await bounded(gate.received)).toBe(200);
      // The held native GET follows this SELECT inside add's actual owning
      // transaction. Identify that connection without extending its lifetime.
      const holders = await query<{ pid: number }>(sql`
        SELECT pid FROM pg_stat_activity WHERE datname = current_database()
          AND state = 'idle in transaction'
          AND query LIKE '%SELECT state, native_pending FROM matrix_room_members%'`);
      expect(holders).toHaveLength(1);
      const [holder] = holders;
      if (!holder) throw new Error("Missing add transaction.");
      removal = changeMatrixGroupMembership(fixture.actor, {
        id: fixture.room.id,
        action: "remove",
        username: fixture.username,
      });
      const settledRemoval = Promise.allSettled([removal]);
      try {
        await expect
          .poll(
            () =>
              query(sql`SELECT pid FROM pg_stat_activity
                WHERE datname = current_database()
                  AND ${holder.pid}::integer = ANY(pg_blocking_pids(pid))
                  AND query LIKE '%pg_advisory_xact_lock%'`),
            { timeout: 5000, interval: 20 }
          )
          .toHaveLength(1);
      } finally {
        gate.release();
        await settledRemoval;
      }
      expect(await addition).toEqual({ nativePending: false });
      expect(await removal).toEqual({ nativePending: false });
      expect(await fixture.membership()).toEqual([
        { state: "removed", native_pending: false },
      ]);
      expect(
        await proxy.nativeMembership(fixture.room.roomId, fixture.matrixId)
      ).toBe("leave");
      await expect(
        requireJoinedMatrixRoom(fixture.guest, fixture.room.id)
      ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
    } finally {
      gate.release();
      await settledAddition;
      if (removal) await Promise.allSettled([removal]);
    }
  }
);

test(
  "workspace revocation prevents manager add from admitting the pending member",
  { timeout: 60000 },
  async () => {
    await using proxy = await matrixProxy();
    await using fixture = await pendingParticipant(proxy);
    expect(
      await removeWorkspaceMember(fixture.actor, fixture.guest.userId)
    ).toEqual({ removed: true });
    await expect(
      changeMatrixGroupMembership(fixture.actor, {
        id: fixture.room.id,
        action: "add",
        username: fixture.username,
      })
    ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
    expect(await fixture.membership()).toEqual([
      { state: "joined", native_pending: true },
    ]);
    expect(
      await proxy.nativeMembership(fixture.room.roomId, fixture.matrixId)
    ).toBe("join");
    await expect(
      requireJoinedMatrixRoom(fixture.guest, fixture.room.id)
    ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  }
);
