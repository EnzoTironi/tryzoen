import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import { createHmac, randomUUID } from "node:crypto";
import type * as Environment from "@shared/environment";
import { Secret } from "@shared/environment/secret";
import { createHTTPServer } from "@trpc/server/adapters/standalone";
import { createTRPCUntypedClient, httpLink } from "@trpc/client";
import { getInstallationSecrets } from "@db/services/installation-secrets";

import { expect, test, vi } from "vitest";
import {
  activatePersonalGoogle,
  readPersonalGoogleSettings,
} from "../../server/google-workspace/settings";
import { readWorkspaceCapabilities } from "../../server/workspaces/capabilities";
import { resolveWorkspaceActor } from "../../server/workspaces/session";
import { appRouter } from "../../web/trpc/router";

import { googleWorkspaceScopes } from "../../shared/google-workspace/connection";
import { capabilitiesPath } from "../../shared/workspaces/capabilities";

import { workspaceFixture } from "./workspace-fixture";

vi.mock("@shared/environment", async (original) => {
  const actual = await original<typeof Environment>();
  return {
    ...actual,
    env: {
      ...actual.env,
      GOOGLE_CLIENT_ID: "synthetic-google-client",
      GOOGLE_CLIENT_SECRET: new Secret("synthetic-google-secret"),
    },
  };
});

async function personalGoogleRPC() {
  const server = createHTTPServer({
    router: appRouter,
    async createContext({ req }) {
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (value !== undefined)
          headers.set(key, Array.isArray(value) ? value.join(", ") : value);
      }
      const actor = await resolveWorkspaceActor(headers);
      return {
        requestHeaders: headers,
        scope: { userId: actor.userId, workspaceId: actor.workspaceId },
      };
    },
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing loopback RPC address");
  const url = `http://127.0.0.1:${address.port}`;
  return {
    async client(
      actor?: Awaited<ReturnType<typeof workspaceFixture>>["actor"]
    ) {
      const headers = new Headers();
      if (actor) {
        const { betterAuthSecret } = await getInstallationSecrets();
        const signature = createHmac("sha256", betterAuthSecret)
          .update(actor.authSessionId)
          .digest("base64");
        headers.set(
          "cookie",
          `better-auth.session_token=${encodeURIComponent(`${actor.authSessionId}.${signature}`)}`
        );
        headers.set("x-zoen-workspace", actor.workspaceId);
      }
      return createTRPCUntypedClient({
        links: [httpLink({ url, headers: Object.fromEntries(headers) })],
      });
    },
    async [Symbol.asyncDispose]() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    },
  };
}

test("Google connection activation enables personal tools without sharing credentials or altering team plugins", async () => {
  await using workspace = await workspaceFixture();
  const { personal, actor } = workspace;
  expect(await readPersonalGoogleSettings(personal)).toEqual({
    state: "disconnected",
  });
  expect(await activatePersonalGoogle(personal)).toEqual({
    authorize: true,
  });
  const enabled = await readWorkspaceCapabilities(personal);
  expect(enabled.enabled).toEqual(["files", "memory", "ontology", "google"]);
  expect((await readWorkspaceCapabilities(actor)).enabled).toEqual([
    "files",
    "memory",
    "ontology",
  ]);
  expect(await activatePersonalGoogle(personal)).toEqual({
    authorize: true,
  });
  expect((await readWorkspaceCapabilities(personal)).revision).toBe(
    enabled.revision
  );
  expect(
    await query(
      sql`SELECT workspace_id FROM workspace_connections WHERE workspace_id IN (${personal.workspaceId}, ${actor.workspaceId})`
    )
  ).toEqual([]);
});

test("reading a paused Google connection cannot reactivate it; explicit activation resumes the existing grant", async () => {
  await using workspace = await workspaceFixture();
  const { personal, repository } = workspace;
  const id = randomUUID();
  await query(sql`INSERT INTO account (id, "accountId", "providerId", "userId", "refreshToken", scope, "updatedAt")
        VALUES (${id}, ${id}, 'google', ${personal.userId.slice(12)}, 'synthetic-token-preserved', ${googleWorkspaceScopes.join(" ")}, now())`);
  expect(await readPersonalGoogleSettings(personal)).toEqual({
    state: "paused",
  });
  expect((await readWorkspaceCapabilities(personal)).enabled).not.toContain(
    "google"
  );
  expect(await activatePersonalGoogle(personal)).toEqual({
    authorize: false,
  });
  expect(await readPersonalGoogleSettings(personal)).toEqual({
    state: "connected",
  });
  const enabled = await readWorkspaceCapabilities(personal);
  await repository.write(personal, {
    path: capabilitiesPath,
    operationId: randomUUID(),
    expectedRevision: enabled.revision,
    content: JSON.stringify({ version: 1, enabled: ["files", "ontology"] }),
  });
  expect(await readPersonalGoogleSettings(personal)).toEqual({
    state: "paused",
  });
  expect((await readWorkspaceCapabilities(personal)).enabled).toEqual([
    "files",
    "ontology",
  ]);
  await activatePersonalGoogle(personal);
  expect((await readWorkspaceCapabilities(personal)).enabled).toEqual([
    "files",
    "ontology",
    "google",
  ]);
  expect(
    await query(sql`SELECT "refreshToken" FROM account WHERE id = ${id}`)
  ).toEqual([{ refreshToken: "synthetic-token-preserved" }]);
});

test("personal Google activation rejects team targets, substituted sessions and revoked sessions", async () => {
  await using workspace = await workspaceFixture();
  const { personal, guestPersonal, actor } = workspace;
  for (const invalid of [
    actor,
    { ...personal, authSessionId: guestPersonal.authSessionId },
  ]) {
    await expect(
      Promise.try(async () => activatePersonalGoogle(invalid))
    ).rejects.toBeInstanceOf(Error);
  }
  await query(
    sql`DELETE FROM public.session WHERE id = ${personal.authSessionId}`
  );
  await expect(
    Promise.try(async () => activatePersonalGoogle(personal))
  ).rejects.toBeInstanceOf(Error);
  expect((await readWorkspaceCapabilities(guestPersonal)).enabled).toEqual([
    "files",
    "memory",
    "ontology",
  ]);
});

test("personal connection settings read and resume the caller's own Google grant from a company workspace", async () => {
  await using workspace = await workspaceFixture();
  await using peer = await personalGoogleRPC();
  const { actor, guest, personal, guestPersonal } = workspace;
  const id = randomUUID();
  await query(sql`INSERT INTO account (id, "accountId", "providerId", "userId", "refreshToken", scope, "updatedAt")
    VALUES (${id}, ${id}, 'google', ${personal.userId.slice(12)}, 'synthetic-private-owner-token', ${googleWorkspaceScopes.join(" ")}, now())`);
  const owner = await peer.client(actor);
  const other = await peer.client(guest);
  const before = await readWorkspaceCapabilities(personal);
  expect(await owner.query("googleWorkspace.read")).toEqual({
    state: "paused",
  });
  expect(await other.query("googleWorkspace.read")).toEqual({
    state: "disconnected",
  });
  expect(await owner.query("accountChannels.list")).toEqual([]);
  expect(await readWorkspaceCapabilities(personal)).toEqual(before);
  const returnTo = "/?view=chat";
  expect(
    await owner.mutation("googleWorkspace.update", {
      action: "connect",
      returnTo,
    })
  ).toEqual({ redirectTo: returnTo, authorize: false });
  expect(await owner.query("googleWorkspace.read")).toEqual({
    state: "connected",
  });
  expect(await other.query("googleWorkspace.read")).toEqual({
    state: "disconnected",
  });
  expect((await readWorkspaceCapabilities(personal)).enabled).toContain(
    "google"
  );
  for (const target of [actor, guestPersonal]) {
    expect((await readWorkspaceCapabilities(target)).enabled).toEqual([
      "files",
      "memory",
      "ontology",
    ]);
  }
  expect(
    await query(
      sql`SELECT workspace_id FROM workspace_connections WHERE workspace_id IN (${personal.workspaceId}, ${actor.workspaceId}, ${guestPersonal.workspaceId})`
    )
  ).toEqual([]);
  expect(
    await query(sql`SELECT "refreshToken" FROM account WHERE id = ${id}`)
  ).toEqual([{ refreshToken: "synthetic-private-owner-token" }]);
});

test("personal connection RPC rejects anonymous, foreign-workspace and revoked sessions", async () => {
  await using workspace = await workspaceFixture();
  await using peer = await personalGoogleRPC();
  const { actor, guestPersonal } = workspace;
  const anonymous = await peer.client();
  const foreign = await peer.client({
    ...actor,
    workspaceId: guestPersonal.workspaceId,
  });
  for (const invalid of [anonymous, foreign]) {
    await expect(invalid.query("googleWorkspace.read")).rejects.toBeInstanceOf(
      Error
    );
    await expect(
      invalid.mutation("googleWorkspace.update", { action: "connect" })
    ).rejects.toBeInstanceOf(Error);
  }
  const revoked = await peer.client(actor);
  expect(await revoked.query("googleWorkspace.read")).toEqual({
    state: "disconnected",
  });
  await query(
    sql`DELETE FROM public.session WHERE id = ${actor.authSessionId}`
  );
  await expect(revoked.query("googleWorkspace.read")).rejects.toBeInstanceOf(
    Error
  );
  await expect(
    revoked.mutation("googleWorkspace.update", { action: "connect" })
  ).rejects.toBeInstanceOf(Error);
});
