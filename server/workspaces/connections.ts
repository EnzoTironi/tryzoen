import { Secret } from "@shared/environment/secret";
import { query, transaction as withDatabaseTransaction } from "@db/queries";
import { sql } from "drizzle-orm";
import { withTimeout } from "../operations/async";
import { jsonString, isValid } from "@shared/validation";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { auth as google } from "@googleapis/gmail";
import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import { getAuth } from "@db/services/auth";
import { env } from "@shared/environment";
import {
  accessScopeForUser,
  type AccessScope,
} from "@shared/identity/access-scope";
import {
  getGoogleWorkspaceToken,
  hasGoogleWorkspaceScopes,
  GoogleWorkspaceError,
} from "../google-workspace";
import {
  requireWorkspaceAccess,
  WorkspaceAccessDenied,
  type WorkspaceActorSchema,
} from "./access";
import { readWorkspaceCapabilities } from "./capabilities";
import { WorkspaceRepository } from "./repository";
import { capabilitiesPath } from "../../shared/workspaces/capabilities";
const CredentialsSchema = z.object({
  workspaceId: z.string(),
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresAt: z.number(),
});
const decodeCredentials = jsonString(CredentialsSchema);
const accountSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  refreshToken: z.nullable(z.string()),
  scope: z.nullable(z.string()),
});
// Google's tokeninfo wire response can contain "true" despite the SDK's boolean type.
const verifiedGoogleEmail = (value: unknown) =>
  isValid(z.union([z.literal(true), z.literal("true")]), value);
export const readWorkspaceConnections = async function (
  actor: z.output<typeof WorkspaceActorSchema>
) {
  const access = await requireWorkspaceAccess(actor);
  const rows = await query(
    sql`SELECT provider, label FROM workspace_connections WHERE workspace_id = ${actor.workspaceId}`
  );
  return {
    connections: await z
      .array(
        z.object({
          provider: z.literal("google"),
          label: z.string(),
        })
      )
      .parseAsync(rows),
    mayManage: access.role !== "member",
  };
};

/** An explicit admin action copies a provider grant into workspace custody. */
export const shareGoogleConnection = async function (
  actor: z.output<typeof WorkspaceActorSchema>
) {
  const access = await requireWorkspaceAccess(actor, true);
  if (!access.organizationId || !actor.authSessionId)
    throw new WorkspaceAccessDenied();
  const token = (
    await getGoogleWorkspaceToken(accessScopeForUser(actor.userId))
  ).reveal();
  const rows =
    await query(sql`SELECT a.id, a."accountId", a."refreshToken", a.scope FROM account a JOIN public.user u ON u.id = a."userId"
    WHERE ('better-auth:' || u.id) = ${actor.userId} AND a."providerId" = 'google' AND a.issuer = 'https://accounts.google.com' LIMIT 2`);
  if (rows.length !== 1)
    throw new GoogleWorkspaceError({
      reason: "authorization_required",
    });
  const account = await accountSchema.parseAsync(rows[0]);
  if (!account.refreshToken || !hasGoogleWorkspaceScopes(account.scope))
    throw new GoogleWorkspaceError({
      reason: "authorization_required",
    });
  const encryptedRefreshToken = account.refreshToken;
  const identity = await withTimeout(async () => {
    try {
      return await new google.OAuth2(env.GOOGLE_CLIENT_ID).getTokenInfo(
        token.token
      );
    } catch {
      throw new GoogleWorkspaceError({
        reason: "authorization_required",
      });
    }
  }, 20000);
  if (
    !identity.email ||
    !verifiedGoogleEmail(identity.email_verified) ||
    identity.aud !== env.GOOGLE_CLIENT_ID ||
    identity.sub !== account.accountId
  ) {
    throw new GoogleWorkspaceError({
      reason: "authorization_required",
    });
  }
  const auth = await getAuth();
  const credentials = await Promise.try(async () => {
    const key = (await auth.$context).secretConfig;
    const refreshToken = await symmetricDecrypt({
      data: encryptedRefreshToken,
      key,
    });
    return symmetricEncrypt({
      key,
      data: JSON.stringify({
        workspaceId: actor.workspaceId,
        accessToken: token.token,
        refreshToken,
        expiresAt: token.expiresAt ?? 0,
      }),
    });
  }).catch(() => {
    throw new GoogleWorkspaceError({
      reason: "unavailable",
    });
  });
  return await withDatabaseTransaction(async () => {
    await requireWorkspaceAccess(actor, true);
    const source =
      await query(sql`SELECT id FROM account WHERE id = ${account.id}
          AND ('better-auth:' || "userId") = ${actor.userId} AND "refreshToken" = ${encryptedRefreshToken} FOR SHARE`);
    if (source.length !== 1)
      throw new GoogleWorkspaceError({
        reason: "authorization_required",
      });
    const capabilities = await readWorkspaceCapabilities(actor);
    if (!capabilities.enabled.includes("google")) {
      await WorkspaceRepository.write(actor, {
        operationId: randomUUID(),
        expectedRevision: capabilities.revision,
        path: capabilitiesPath,
        content: JSON.stringify(
          {
            version: 1,
            enabled: [...capabilities.enabled, "google"],
          },
          null,
          2
        ),
      });
    }
    await query(sql`INSERT INTO workspace_connections(workspace_id, provider, label, credentials, connected_by)
      VALUES (${actor.workspaceId}, 'google', ${identity.email}, ${credentials}, ${actor.userId})
      ON CONFLICT (workspace_id) DO UPDATE SET label = EXCLUDED.label, credentials = EXCLUDED.credentials,
        connected_by = EXCLUDED.connected_by, revision = ${randomUUID()}, updated_at = now()`);
    return {
      connected: true,
    };
  });
};
export const disconnectWorkspaceGoogle = async function (
  actor: z.output<typeof WorkspaceActorSchema>
) {
  return await withDatabaseTransaction(async () => {
    await requireWorkspaceAccess(actor, true);
    await query(
      sql`DELETE FROM workspace_connections WHERE workspace_id = ${actor.workspaceId}`
    );
    // Google revocation would also revoke the same person's other grants to this
    // OAuth client. Disconnect here removes only this explicitly shared copy.
    return {
      disconnected: true,
    };
  });
};
export const getWorkspaceGoogleToken = async function (scope: AccessScope) {
  return await withDatabaseTransaction(async () => {
    // Serialize refreshes across processes without locking revocation or re-sharing.
    await query(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${scope.workspaceId}, 3))`
    );
    const rows = await query<{
      credentials: string;
      revision: string;
    }>(sql`SELECT c.credentials, c.revision FROM workspace_connections c
    JOIN workspace_memberships m ON m.workspace_id = c.workspace_id AND m.user_id = ${scope.userId}
    JOIN workspaces w ON w.id = c.workspace_id JOIN organization_memberships o ON o.organization_id = w.organization_id AND o.user_id = m.user_id
    WHERE c.workspace_id = ${scope.workspaceId}`);
    const row = rows[0];
    if (!row)
      throw new GoogleWorkspaceError({
        reason: "authorization_required",
      });
    const auth = await getAuth();
    const payload = await Promise.try(
      async () =>
        new Secret(
          await symmetricDecrypt({
            data: row.credentials,
            key: (await auth.$context).secretConfig,
          })
        )
    ).catch(() => {
      throw new GoogleWorkspaceError({
        reason: "unavailable",
      });
    });
    let credentials = await decodeCredentials.parseAsync(payload.reveal());
    if (credentials.workspaceId !== scope.workspaceId)
      throw new GoogleWorkspaceError({
        reason: "unauthenticated",
      });
    const now = new Date().getTime();
    if (credentials.expiresAt < now + 60_000) {
      const updated = await withTimeout(async () => {
        try {
          const client = new google.OAuth2(
            env.GOOGLE_CLIENT_ID,
            env.GOOGLE_CLIENT_SECRET
              ? env.GOOGLE_CLIENT_SECRET.reveal()
              : undefined
          );
          client.setCredentials({
            refresh_token: credentials.refreshToken,
          });
          return new Secret((await client.refreshAccessToken()).credentials);
        } catch {
          throw new GoogleWorkspaceError({
            reason: "authorization_required",
          });
        }
      }, 20000);
      const refreshed = updated.reveal();
      if (!refreshed.access_token || !refreshed.expiry_date)
        throw new GoogleWorkspaceError({
          reason: "authorization_required",
        });
      credentials = {
        ...credentials,
        accessToken: refreshed.access_token,
        refreshToken: refreshed.refresh_token ?? credentials.refreshToken,
        expiresAt: refreshed.expiry_date,
      };
      const encrypted = await Promise.try(async () =>
        symmetricEncrypt({
          data: JSON.stringify(credentials),
          key: (await auth.$context).secretConfig,
        })
      ).catch(() => {
        throw new GoogleWorkspaceError({
          reason: "unavailable",
        });
      });
      const saved =
        await query(sql`UPDATE workspace_connections SET credentials = ${encrypted}, updated_at = now()
      WHERE workspace_id = ${scope.workspaceId} AND revision = ${row.revision} RETURNING workspace_id`);
      if (!saved.length)
        throw new GoogleWorkspaceError({
          reason: "authorization_required",
        });
    }
    const current =
      await query(sql`SELECT c.workspace_id FROM workspace_connections c
    JOIN workspace_memberships m ON m.workspace_id = c.workspace_id AND m.user_id = ${scope.userId}
    JOIN workspaces w ON w.id = c.workspace_id JOIN organization_memberships o ON o.organization_id = w.organization_id AND o.user_id = m.user_id
    WHERE c.workspace_id = ${scope.workspaceId} AND c.revision = ${row.revision}`);
    if (!current.length)
      throw new GoogleWorkspaceError({
        reason: "authorization_required",
      });
    return new Secret({
      token: credentials.accessToken,
      expiresAt: credentials.expiresAt,
    });
  });
};
