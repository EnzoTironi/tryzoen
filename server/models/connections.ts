import { query, transaction as withDatabaseTransaction } from "@db/queries";
import { sql } from "drizzle-orm";
import { jsonString } from "@shared/validation";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import {
  requireWorkspaceAccess,
  WorkspaceAccessDenied,
  type WorkspaceActorSchema,
} from "../workspaces/access";
import {
  ModelConnectionError,
  ModelProviderSchema,
  WorkspaceModelSchema,
  defaultWorkspaceModel,
  modelCatalog,
} from "../../shared/models/catalog";
import {
  beginModelOAuth,
  DevicePayloadSchema,
  ModelTokensSchema,
  pollModelOAuth,
  refreshModelOAuth,
} from "./oauth";
import { openModelSecret, sealModelSecret } from "./secrets";
const Connection = z.object({
  provider: ModelProviderSchema,
  model: WorkspaceModelSchema,
  revision: z.string(),
  credentials: z.nullable(z.string()),
});
const Request = z.object({
  provider: ModelProviderSchema,
  payload: z.string(),
  interval_seconds: z.number(),
  remaining: z.number(),
  wait: z.number(),
});
const decodeTokens = jsonString(ModelTokensSchema);
export const readModelConnection = async function (
  actor: z.output<typeof WorkspaceActorSchema>
) {
  const access = await requireWorkspaceAccess(actor);
  const rows = await query(
    sql`SELECT provider, model, revision, credentials IS NOT NULL AS connected FROM model_connections WHERE workspace_id = ${actor.workspaceId}`
  );
  const connections = await z
    .array(
      z.object({
        provider: ModelProviderSchema,
        model: WorkspaceModelSchema,
        revision: z.string(),
        connected: z.boolean(),
      })
    )
    .parseAsync(rows);
  return {
    connection: connections[0] ?? null,
    mayManage: access.role !== "member" && Boolean(actor.authSessionId),
    team: Boolean(access.organizationId),
  };
};
export const startModelConnection = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  provider: z.output<typeof ModelProviderSchema>
) {
  if (!actor.authSessionId) throw new WorkspaceAccessDenied();
  const authSessionId = actor.authSessionId;
  return await withDatabaseTransaction(async () => {
    await requireWorkspaceAccess(actor, true);
    await query(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${actor.workspaceId}, 5813))`
    );
    const recent = await query(
      sql`SELECT id FROM model_oauth_requests WHERE workspace_id = ${actor.workspaceId} AND created_at > now() - interval '1 hour'`
    );
    if (recent.length >= 8)
      throw new ModelConnectionError({
        reason: "rate_limited",
      });
    const device = await beginModelOAuth(provider);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + device.expiresIn * 1000);
    const id = randomUUID();
    const payload = await sealModelSecret(
      actor.workspaceId,
      provider,
      JSON.stringify({
        deviceCode: device.deviceCode,
        userCode: device.userCode,
      })
    );
    // Starting another request invalidates older challenges in this workspace.
    await query(
      sql`UPDATE model_oauth_requests SET payload = '' WHERE workspace_id = ${actor.workspaceId}`
    );
    await query(
      sql`DELETE FROM model_oauth_requests WHERE workspace_id = ${actor.workspaceId} AND created_at < now() - interval '1 day'`
    );
    await query(sql`INSERT INTO model_oauth_requests(id, workspace_id, user_id, auth_session_id, provider, payload, interval_seconds, expires_at)
      VALUES (${id}, ${actor.workspaceId}, ${actor.userId}, ${authSessionId}, ${provider}, ${payload}, ${device.interval}, ${expiresAt})`);
    return {
      id,
      userCode: device.userCode,
      verificationUri: device.verificationUri,
      expiresAt: expiresAt.toISOString(),
      interval: device.interval,
    };
  });
};
export const finishModelConnection = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  id: string
) {
  if (!actor.authSessionId) throw new WorkspaceAccessDenied();
  return await withDatabaseTransaction(async () => {
    await requireWorkspaceAccess(actor, true);
    await query(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${actor.workspaceId}, 5813))`
    );
    const rows =
      await query(sql`SELECT provider, payload, interval_seconds, extract(epoch from (expires_at - now()))::float8 AS remaining,
      extract(epoch from (next_poll_at - now()))::float8 AS wait FROM model_oauth_requests
      WHERE id = ${id} AND workspace_id = ${actor.workspaceId} AND user_id = ${actor.userId} AND auth_session_id = ${actor.authSessionId} FOR UPDATE`);
    if (rows.length !== 1)
      throw new ModelConnectionError({
        reason: "expired",
      });
    const request = await Request.parseAsync(rows[0]);
    if (!request.payload || request.remaining <= 0)
      throw new ModelConnectionError({
        reason: "expired",
      });
    if (request.wait > 0)
      return {
        status: "pending",
        interval: Math.ceil(request.wait),
      } as const;
    const plain = await openModelSecret(
      actor.workspaceId,
      request.provider,
      request.payload
    );
    const payload = await jsonString(DevicePayloadSchema).parseAsync(plain);
    const result = await Promise.try(async () =>
      pollModelOAuth(request.provider, payload)
    ).then(
      (value) => ({
        ok: true as const,
        value,
      }),
      (error: unknown) => ({
        ok: false as const,
        error,
      })
    );
    if (!result.ok) {
      await query(
        sql`UPDATE model_oauth_requests SET payload = '' WHERE id = ${id}`
      );
      return {
        status: "failed",
      } as const;
    }
    if (result.value.status !== "connected") {
      const interval = Math.min(
        60,
        request.interval_seconds + (result.value.status === "slow_down" ? 5 : 0)
      );
      await query(
        sql`UPDATE model_oauth_requests SET interval_seconds = ${interval}, next_poll_at = now() + ${interval} * interval '1 second' WHERE id = ${id}`
      );
      return {
        status: "pending",
        interval,
      } as const;
    }
    const credentials = await sealModelSecret(
      actor.workspaceId,
      request.provider,
      JSON.stringify(result.value.tokens)
    );
    await query(sql`INSERT INTO model_connections(workspace_id, provider, model, credentials, connected_by)
      VALUES (${actor.workspaceId}, ${request.provider}, ${defaultWorkspaceModel[request.provider]}, ${credentials}, ${actor.userId})
      ON CONFLICT (workspace_id) DO UPDATE SET provider = EXCLUDED.provider, model = EXCLUDED.model, credentials = EXCLUDED.credentials,
        connected_by = EXCLUDED.connected_by, revision = ${randomUUID()}, updated_at = now()`);
    await query(
      sql`UPDATE model_oauth_requests SET payload = '' WHERE id = ${id}`
    );
    return {
      status: "connected",
    } as const;
  });
};
export const selectWorkspaceModel = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  model: z.output<typeof WorkspaceModelSchema>
) {
  await withDatabaseTransaction(async () => {
    await requireWorkspaceAccess(actor, true);
    if (!actor.authSessionId) throw new WorkspaceAccessDenied();
    const rows =
      await query(sql`UPDATE model_connections SET model = ${model}, revision = ${randomUUID()}, updated_at = now()
      WHERE workspace_id = ${actor.workspaceId} AND provider = ${modelCatalog[model].provider} AND credentials IS NOT NULL RETURNING workspace_id`);
    if (rows.length !== 1)
      throw new ModelConnectionError({
        reason: "changed",
      });
    return undefined;
  });
};
export const disconnectModel = async function (
  actor: z.output<typeof WorkspaceActorSchema>
) {
  await withDatabaseTransaction(async () => {
    await requireWorkspaceAccess(actor, true);
    if (!actor.authSessionId) throw new WorkspaceAccessDenied();
    await query(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${actor.workspaceId}, 5813))`
    );
    await query(
      sql`UPDATE model_oauth_requests SET payload = '' WHERE workspace_id = ${actor.workspaceId}`
    );
    await query(
      sql`UPDATE model_connections SET credentials = NULL, revision = ${randomUUID()}, updated_at = now() WHERE workspace_id = ${actor.workspaceId}`
    );
    return undefined;
  });
};

/** Refresh under a database row lock: replicas never race a rotating refresh token. */
export const modelCredentials = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  expectedRevision?: string,
  rejectedAccessToken?: string
) {
  return await withDatabaseTransaction(async () => {
    await requireWorkspaceAccess(actor);
    const rows = await query(
      sql`SELECT provider, model, revision, credentials FROM model_connections WHERE workspace_id = ${actor.workspaceId} FOR UPDATE`
    );
    if (rows.length === 0) {
      if (expectedRevision)
        throw new ModelConnectionError({
          reason: "changed",
        });
      return null;
    }
    const connection = await Connection.parseAsync(rows[0]);
    if (
      expectedRevision &&
      (connection.revision !== expectedRevision || !connection.credentials)
    )
      throw new ModelConnectionError({
        reason: "changed",
      });
    if (!connection.credentials) return null;
    const plain = await openModelSecret(
      actor.workspaceId,
      connection.provider,
      connection.credentials
    );
    let tokens = await decodeTokens.parseAsync(plain);
    const now = new Date();
    if (
      tokens.expiresAt < now.getTime() + 300_000 ||
      tokens.accessToken === rejectedAccessToken
    ) {
      tokens = await refreshModelOAuth(connection.provider, tokens);
      const encrypted = await sealModelSecret(
        actor.workspaceId,
        connection.provider,
        JSON.stringify(tokens)
      );
      await query(
        sql`UPDATE model_connections SET credentials = ${encrypted}, updated_at = now() WHERE workspace_id = ${actor.workspaceId}`
      );
    }
    return {
      provider: connection.provider,
      model: connection.model,
      revision: connection.revision,
      tokens,
    };
  });
};
