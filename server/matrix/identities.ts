import type { z } from "zod";
import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import { MatrixError } from "./client";
import { createHash } from "node:crypto";
import type { WorkspaceActorSchema } from "../workspaces/access";
import { matrixConfiguration, matrixRequest } from "./client";

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

export const ensureMatrixIdentity = async function (
  actor: z.output<typeof WorkspaceActorSchema>
) {
  const config = await matrixConfiguration();

  const localpart = `_zoen_${createHash("sha256").update(actor.userId).digest("hex").slice(0, 32)}`;
  const matrixId = `@${localpart}:${config.serverName}`;
  const existing = await query<{
    displayName: string;
  }>(
    sql`SELECT display_name AS "displayName" FROM matrix_identities WHERE user_id = ${actor.userId} AND matrix_id = ${matrixId}`
  );
  if (!existing.length) {
    await registerVirtualUser(localpart);
    await query(
      sql`INSERT INTO matrix_identities(user_id, matrix_id) VALUES (${actor.userId}, ${matrixId}) ON CONFLICT DO NOTHING`
    );
  }
  const names = await query<{
    name: string;
  }>(
    sql`SELECT COALESCE(d.username, u.name) AS name FROM public.user u LEFT JOIN user_directory d ON d.user_id = u.id WHERE ('better-auth:' || u.id) = ${actor.userId}`
  );
  if (names[0] && names[0].name !== existing[0]?.displayName) {
    await matrixRequest(
      "PUT",
      `profile/${encodeURIComponent(matrixId)}/displayname`,
      { displayname: names[0].name },
      matrixId
    );
    await query(
      sql`UPDATE matrix_identities SET display_name = ${names[0].name} WHERE user_id = ${actor.userId}`
    );
  }
  return matrixId;
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
