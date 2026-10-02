import type { z } from "zod";
import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import { MatrixError } from "./client";
import { createHash } from "node:crypto";
import {
  WorkspaceAccessDenied,
  type WorkspaceActorSchema,
} from "../workspaces/access";
import { matrixConfiguration, matrixRequest } from "./client";
import type { matrixIdentities } from "../../db/schema/matrix";

export const registerVirtualUser = async function (localpart: string) {
  await Promise.try(async () =>
    matrixRequest("POST", "register", {
      type: "m.login.application_service",
      username: localpart,
      inhibit_login: true,
    })
  ).catch((error: unknown) => {
    if (error instanceof MatrixError)
      return error.reason === "conflict"
        ? Promise.resolve()
        : Promise.reject(error);
    throw error;
  });
};

/** The single canonical human namespace, shared by staging and native recovery. */
export function matrixIdentityForUser(userId: string, serverName: string) {
  const localpart = `_zoen_${createHash("sha256").update(userId).digest("hex").slice(0, 32)}`;
  return { localpart, matrixId: `@${localpart}:${serverName}` };
}

/** SQL presence is an exact locator, never proof of native registration. The
 * caller owns authorization, binding locks and the enclosing commit.
 */
export async function stageMatrixIdentity(
  actor: Pick<z.output<typeof WorkspaceActorSchema>, "userId">
) {
  const config = await matrixConfiguration();
  const identity = matrixIdentityForUser(actor.userId, config.serverName);
  const read = () =>
    query<
      Pick<typeof matrixIdentities.$inferSelect, "matrixId" | "displayName">
    >(
      sql`SELECT matrix_id AS "matrixId", display_name AS "displayName" FROM matrix_identities
      WHERE user_id = ${actor.userId}`
    );
  let rows = await read();
  if (!rows.length) {
    await query(sql`INSERT INTO matrix_identities(user_id, matrix_id)
      VALUES (${actor.userId}, ${identity.matrixId}) ON CONFLICT DO NOTHING`);
    rows = await read();
  }
  const row = rows[0];
  if (rows.length !== 1 || !row || row.matrixId !== identity.matrixId)
    throw new WorkspaceAccessDenied();
  return { ...identity, displayName: row.displayName };
}

export const ensureMatrixIdentity = async function (
  actor: Pick<z.output<typeof WorkspaceActorSchema>, "userId">
) {
  const identity = await stageMatrixIdentity(actor);
  // A committed participation intent may have staged this row before a crash.
  // Registration remains idempotent even when its SQL locator already exists.
  await registerVirtualUser(identity.localpart);
  const names = await query<{ name: string }>(
    sql`SELECT u.name AS name FROM public.user u WHERE ('better-auth:' || u.id) = ${actor.userId}`
  );
  if (names[0] && names[0].name !== identity.displayName) {
    await matrixRequest(
      "PUT",
      `profile/${encodeURIComponent(identity.matrixId)}/displayname`,
      { displayname: names[0].name },
      identity.matrixId
    );
    await query(sql`UPDATE matrix_identities SET display_name = ${names[0].name}
      WHERE user_id = ${actor.userId}`);
  }
  return identity.matrixId;
};

export const ensureMatrixBot = async function (id: string, name: string) {
  const config = await matrixConfiguration();
  const localpart = `_zoen_agent_${id.replaceAll("-", "")}`;
  const matrixId = `@${localpart}:${config.serverName}`;
  await registerVirtualUser(localpart);
  await matrixRequest(
    "PUT",
    `profile/${encodeURIComponent(matrixId)}/displayname`,
    { displayname: name },
    matrixId
  );
  return matrixId;
};
