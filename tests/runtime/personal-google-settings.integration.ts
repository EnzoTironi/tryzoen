import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type * as Environment from "@shared/environment";

import { expect, test, vi } from "vitest";
import {
  activatePersonalGoogle,
  readPersonalGoogleSettings,
} from "../../server/google-workspace/settings";
import { readWorkspaceCapabilities } from "../../server/workspaces/capabilities";

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
      GOOGLE_CLIENT_SECRET: "synthetic-google-secret",
    },
  };
});

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
  await query(sql`INSERT INTO account (id, issuer, "accountId", "providerId", "userId", "refreshToken", scope, "updatedAt")
        VALUES (${id}, 'https://accounts.google.com', ${id}, 'google', ${personal.userId.slice(12)}, 'synthetic-token-preserved', ${googleWorkspaceScopes.join(" ")}, now())`);
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
    expect(
      !(
        await Promise.try(async () => activatePersonalGoogle(invalid)).then(
          (value) => ({ ok: true as const, value }),
          (error: unknown) => ({ ok: false as const, error })
        )
      ).ok
    ).toBe(true);
  }
  await query(
    sql`DELETE FROM public.session WHERE id = ${personal.authSessionId}`
  );
  expect(
    !(
      await Promise.try(async () => activatePersonalGoogle(personal)).then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error })
      )
    ).ok
  ).toBe(true);
  expect((await readWorkspaceCapabilities(guestPersonal)).enabled).toEqual([
    "files",
    "memory",
    "ontology",
  ]);
});
