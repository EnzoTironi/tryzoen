import { spawn } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { createConnection, createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { expect, onTestFinished, test } from "vitest";
import { z } from "zod";
import { query } from "../../db/queries";
import { getInstallationSecrets } from "../../db/services/installation-secrets";
import { workspaceFixture } from "./workspace-fixture";

const require = createRequire(import.meta.url);
const rpcSuccessSchema = z.object({
  result: z.object({ data: z.unknown() }),
});
const rpcFailureSchema = z.object({
  error: z.object({
    message: z.string(),
    code: z.number(),
    data: z.object({
      code: z.string(),
      httpStatus: z.number(),
      path: z.string().optional(),
    }),
  }),
});

async function nextHTTPServer(betterAuthSecret: string) {
  const listener = createServer();
  await new Promise<void>((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", resolve);
  });
  const address = listener.address();
  await new Promise<void>((resolve, reject) => {
    listener.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
  if (!address || typeof address === "string")
    throw new Error("Missing loopback Next address");
  const base = `http://127.0.0.1:${address.port}`;
  const child = spawn(
    process.execPath,
    [
      require.resolve("next/dist/bin/next"),
      "dev",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(address.port),
    ],
    {
      cwd: fileURLToPath(new URL("../../", import.meta.url)),
      detached: process.platform !== "win32",
      env: {
        ...process.env,
        NODE_ENV: "development",
        PORT: String(address.port),
        BETTER_AUTH_URL: base,
        BETTER_AUTH_SECRET: betterAuthSecret,
        EVE_BASE_URL: "http://127.0.0.1:1",
        NEXT_TELEMETRY_DISABLED: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  let output = "";
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-4_000);
    });
  let spawnError: Error | undefined;
  child.once("error", (error) => {
    spawnError = error;
  });
  const closed = new Promise<void>((resolve) =>
    child.once("close", () => {
      resolve();
    })
  );
  function sendSignal(signal: NodeJS.Signals) {
    if (!child.pid) return;
    try {
      if (process.platform === "win32") child.kill(signal);
      else process.kill(-child.pid, signal);
    } catch (error) {
      if (
        !(error instanceof Error && "code" in error && error.code === "ESRCH")
      )
        throw error;
    }
  }
  let cleanup: Promise<void> | undefined;
  function stop() {
    return (cleanup ??= (async () => {
      sendSignal("SIGTERM");
      await Promise.race([closed, delay(3_000, undefined, { ref: false })]);
      sendSignal("SIGKILL");
      await closed;
    })());
  }
  onTestFinished(stop);
  try {
    const deadline = Date.now() + 30_000;
    for (;;) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null || child.signalCode !== null)
        throw new Error(`Next exited before listening:\n${output}`);
      const connected = await new Promise<boolean>((resolve) => {
        const socket = createConnection({
          host: "127.0.0.1",
          port: address.port,
        });
        const finish = (ready: boolean) => {
          socket.destroy();
          resolve(ready);
        };
        socket.once("connect", () => {
          finish(true);
        });
        socket.once("error", () => {
          finish(false);
        });
        socket.setTimeout(250, () => {
          finish(false);
        });
      });
      if (connected) break;
      if (Date.now() >= deadline)
        throw new Error(`Next did not listen within 30 seconds:\n${output}`);
      await delay(100);
    }
    return { base, [Symbol.asyncDispose]: stop };
  } catch (error) {
    await stop();
    throw error;
  }
}

test(
  "Next HTTP denies foreign and revoked workspace selection before RPC execution",
  { timeout: 180_000 },
  async () => {
    const deadline = Date.now() + 165_000;
    await using workspace = await workspaceFixture();
    const { betterAuthSecret } = await getInstallationSecrets();
    await using next = await nextHTTPServer(betterAuthSecret);
    const cookieFor = (authSessionId: string) => {
      const signature = createHmac("sha256", betterAuthSecret)
        .update(authSessionId)
        .digest("base64");
      return `better-auth.session_token=${encodeURIComponent(`${authSessionId}.${signature}`)}`;
    };
    const ownerCookie = cookieFor(workspace.actor.authSessionId);
    const guestCookie = cookieFor(workspace.guest.authSessionId);
    const missing = `missing-${randomUUID()}`;
    const identities = [
      ...Object.values(workspace.actor),
      ...Object.values(workspace.guest),
      workspace.personal.workspaceId,
      workspace.guestPersonal.workspaceId,
      missing,
      "Synthetic owner",
      "Synthetic guest",
      "Synthetic company",
    ];
    async function request(
      path: string,
      workspaceId?: string,
      cookie = ownerCookie
    ) {
      const headers = new Headers();
      if (cookie) headers.set("cookie", cookie);
      if (workspaceId !== undefined)
        headers.set("x-zoen-workspace", workspaceId);
      const response = await fetch(`${next.base}${path}`, {
        headers,
        redirect: "manual",
        signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
      });
      return { response, body: await response.text() };
    }
    async function succeeds(workspaceId: string, cookie = ownerCookie) {
      const { response, body } = await request(
        "/api/trpc/workspaces.list",
        workspaceId,
        cookie
      );
      expect(response.status).toBe(200);
      const payload: unknown = JSON.parse(body);
      rpcSuccessSchema.parse(payload);
    }
    async function denied(
      path: string,
      workspaceId: string,
      cookie = ownerCookie
    ) {
      const { response, body } = await request(path, workspaceId, cookie);
      expect(response.status).toBe(403);
      for (const identity of identities) expect(body).not.toContain(identity);
      const payload: unknown = JSON.parse(body);
      const errors = z
        .array(rpcFailureSchema)
        .parse(Array.isArray(payload) ? payload : [payload]);
      expect(errors).toHaveLength(path.includes("batch=1") ? 2 : 1);
      for (const { error } of errors) {
        expect(error.message).toBe("FORBIDDEN");
        expect(error.code).toBe(-32003);
        expect(error.data.code).toBe("FORBIDDEN");
        expect(error.data.httpStatus).toBe(403);
      }
      return body;
    }

    await succeeds(workspace.personal.workspaceId);
    await succeeds(workspace.actor.workspaceId);
    await succeeds(workspace.guest.workspaceId, guestCookie);
    const rpcPath = "/api/trpc/workspaces.memory.read";
    const foreign = await denied(rpcPath, workspace.guestPersonal.workspaceId);
    expect(await denied(rpcPath, missing)).toEqual(foreign);

    const batchPath = "/api/trpc/workspaces.list,accountChannels.list?batch=1";
    const batch = await request(batchPath, workspace.actor.workspaceId);
    expect(batch.response.status).toBe(200);
    const batchPayload: unknown = JSON.parse(batch.body);
    expect(z.array(rpcSuccessSchema).parse(batchPayload)).toHaveLength(2);
    await denied(batchPath, workspace.guestPersonal.workspaceId);

    await query(sql`DELETE FROM workspace_memberships
    WHERE workspace_id = ${workspace.guest.workspaceId} AND user_id = ${workspace.guest.userId}`);
    await denied(
      "/api/trpc/workspaces.list",
      workspace.guest.workspaceId,
      guestCookie
    );
    const page = await request(
      `/space/memory?space=${encodeURIComponent(workspace.guestPersonal.workspaceId)}`
    );
    expect(page.response.status).toBe(404);

    const anonymous = await request("/api/trpc/workspaces.list", undefined, "");
    expect(anonymous.response.status).toBe(307);
    expect(anonymous.response.headers.get("location")).toBe(
      "/sign-in?callbackUrl=%2Fapi%2Ftrpc%2Fworkspaces.list"
    );
  }
);
