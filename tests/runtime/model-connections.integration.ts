import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import { sleep } from "../../server/operations/async";

import { expect, test, vi, afterEach } from "vitest";

import { workspaceFixture } from "./workspace-fixture";
import {
  disconnectModel,
  finishModelConnection,
  modelCredentials,
  readModelConnection,
  selectWorkspaceModel,
  startModelConnection,
} from "../../server/models/connections";
import * as oauth from "../../server/models/oauth";
import { sealModelSecret } from "../../server/models/secrets";

vi.mock("../../db/services/auth", async () => {
  return {
    getAuth: async () => ({
      $context: Promise.resolve({
        secretConfig: "synthetic-model-connection-test-key",
      }),
    }),
  };
});

afterEach(() => vi.restoreAllMocks());
const tokens = {
  accessToken: "synthetic-access",
  refreshToken: "synthetic-refresh",
  accountId: "synthetic-account",
  expiresAt: Date.now() + 3_600_000,
};

test("device authorization is bound to session and workspace, with encrypted custody and one-time completion", async () => {
  await using workspace = await workspaceFixture();
  const { actor, guest, personal } = workspace;
  vi.spyOn(oauth, "beginModelOAuth").mockReturnValue(
    Promise.resolve({
      deviceCode: "synthetic-device",
      userCode: "PROOF",
      verificationUri: "https://auth.openai.com/codex/device",
      interval: 5,
      expiresIn: 900,
    })
  );
  vi.spyOn(oauth, "pollModelOAuth").mockReturnValue(
    Promise.resolve({ status: "connected", tokens })
  );
  expect(
    !(
      await Promise.try(async () =>
        startModelConnection(guest, "chatgpt")
      ).then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error })
      )
    ).ok
  ).toBe(true);
  const challenge = await startModelConnection(actor, "chatgpt");
  expect(
    !(
      await Promise.try(async () =>
        finishModelConnection(personal, challenge.id)
      ).then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error })
      )
    ).ok
  ).toBe(true);
  expect(
    !(
      await Promise.try(async () =>
        finishModelConnection(
          { ...actor, authSessionId: "foreign-session" },
          challenge.id
        )
      ).then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error })
      )
    ).ok
  ).toBe(true);
  expect((await finishModelConnection(actor, challenge.id)).status).toBe(
    "connected"
  );
  expect(
    !(
      await Promise.try(async () =>
        finishModelConnection(actor, challenge.id)
      ).then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error })
      )
    ).ok
  ).toBe(true);
  expect((await modelCredentials(guest))?.tokens.accessToken).toBe(
    "synthetic-access"
  );
  expect(await modelCredentials(personal)).toBeNull();
  expect(JSON.stringify(await readModelConnection(guest))).not.toContain(
    "synthetic-access"
  );
  const raw = await query(
    sql`SELECT credentials FROM model_connections WHERE workspace_id = ${actor.workspaceId}`
  );
  expect(JSON.stringify(raw)).not.toContain("synthetic-refresh");
  expect(
    !(
      await Promise.try(async () =>
        selectWorkspaceModel(actor, "grok-4.6")
      ).then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error })
      )
    ).ok
  ).toBe(true);
  const before = await modelCredentials(actor);
  await disconnectModel(actor);
  expect(await modelCredentials(actor)).toBeNull();
  expect(
    !(
      await Promise.try(async () =>
        modelCredentials(actor, before?.revision)
      ).then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error })
      )
    ).ok
  ).toBe(true);
});

test("parallel workers refresh a rotating credential once; removed members lose inference access", async () => {
  await using workspace = await workspaceFixture();
  const { actor, guest } = workspace;
  const encrypted = await sealModelSecret(
    actor.workspaceId,
    "chatgpt",
    JSON.stringify({ ...tokens, expiresAt: 0 })
  );
  await query(
    sql`INSERT INTO model_connections(workspace_id, provider, model, credentials, connected_by) VALUES (${actor.workspaceId}, 'chatgpt', 'gpt-5.6-luna', ${encrypted}, ${actor.userId})`
  );
  const refresh = vi
    .spyOn(oauth, "refreshModelOAuth")
    .mockImplementation(() =>
      Promise.try(async () => sleep(30)).then(async () => tokens)
    );
  const results = await Promise.all([
    modelCredentials(actor),
    modelCredentials(guest),
  ]);
  expect(
    results.every((result) => result?.tokens.accessToken === tokens.accessToken)
  ).toBe(true);
  expect(refresh).toHaveBeenCalledTimes(1);
  const rotated = { ...tokens, accessToken: "renewed-after-rejection" };
  refresh.mockReturnValue(Promise.resolve(rotated));
  const retried = await Promise.all(
    results.map((result) =>
      modelCredentials(actor, result?.revision, tokens.accessToken)
    )
  );
  expect(
    retried.every(
      (result) => result?.tokens.accessToken === rotated.accessToken
    )
  ).toBe(true);
  expect(refresh).toHaveBeenCalledTimes(2);
  await query(
    sql`DELETE FROM workspace_memberships WHERE workspace_id = ${actor.workspaceId} AND user_id = ${guest.userId}`
  );
  expect(
    !(
      await Promise.try(async () => modelCredentials(guest)).then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error })
      )
    ).ok
  ).toBe(true);
});
