import { createHash } from "node:crypto";
import { query, SqlError, transaction } from "@db/queries";
import { sql } from "drizzle-orm";
import { z } from "zod";
import {
  DirectoryError,
  UsernameSchema,
  validateUsername,
} from "../accounts/directory";
import { operationSignal } from "../operations/async";
import {
  requireWorkspaceAccess,
  WorkspaceAccessDenied,
  WorkspaceActorSchema,
} from "./access";

const memberFields = z.object({
  id: z.uuid(),
  workspaceId: z.string().min(1).max(200),
  username: UsernameSchema,
  name: z.string().trim().min(1).max(60),
  description: z.string().max(240),
  createdBy: z.string().min(1).max(200),
  createdAt: z.coerce.date(),
  revokedAt: z.coerce.date().nullable(),
});
export const ExternalAgentMemberSchema = memberFields
  .extend({
    principal: z.string(),
    status: z.enum(["registered", "revoked"]),
  })
  .refine(
    (member) =>
      member.principal === `agent:${member.id}` &&
      member.status === (member.revokedAt ? "revoked" : "registered")
  );

export const ExternalAgentRegistrationSchema = z.strictObject({
  operationId: z.uuid(),
  username: UsernameSchema,
  name: z.string().trim().min(1).max(60),
  description: z.string().max(240).default(""),
});
export const ExternalAgentListSchema = z.strictObject({
  cursor: z.uuid().optional(),
  limit: z.number().int().min(1).max(100).default(50),
});

export class ExternalAgentMemberError extends Error {
  readonly _tag = "ExternalAgentMemberError";
  constructor(
    readonly code: "invalid_input" | "conflict" | "unavailable",
    options?: ErrorOptions
  ) {
    super("External agent member operation failed.", options);
    this.name = "ExternalAgentMemberError";
  }
}

function humanActor(raw: z.input<typeof WorkspaceActorSchema>) {
  const result = WorkspaceActorSchema.safeParse(raw);
  if (!result.success) throw new WorkspaceAccessDenied();
  const actor = result.data;
  if (
    !actor.authSessionId ||
    actor.channelIdentityId ||
    actor.matrixIdentityId ||
    actor.agentGrantId ||
    actor.protocolTaskId ||
    actor.scheduledRunId ||
    actor.scheduledRunLeaseToken ||
    actor.groupBindingId ||
    actor.groupEpoch
  )
    throw new WorkspaceAccessDenied();
  return actor;
}

const columns = sql`id, workspace_id AS "workspaceId", username, name, description,
  created_by AS "createdBy", created_at AS "createdAt", revoked_at AS "revokedAt"`;
const receiptSchema = memberFields.extend({
  registrationRequestHash: z.string().regex(/^[0-9a-f]{64}$/u),
});

function projectMember(row: unknown) {
  const member = memberFields.parse(row);
  return ExternalAgentMemberSchema.parse({
    ...member,
    principal: `agent:${member.id}`,
    status: member.revokedAt ? "revoked" : "registered",
  });
}

function memberFailure(error: unknown): never {
  operationSignal().throwIfAborted();
  if (error instanceof SqlError) {
    let cause: unknown = error.cause;
    const seen = new Set<unknown>();
    while (cause && typeof cause === "object" && !seen.has(cause)) {
      seen.add(cause);
      if ("code" in cause && cause.code === "23505")
        throw new ExternalAgentMemberError("conflict", { cause: error });
      cause = "cause" in cause ? cause.cause : undefined;
    }
    throw new ExternalAgentMemberError("unavailable", { cause: error });
  }
  if (error instanceof z.ZodError)
    throw new ExternalAgentMemberError("unavailable", { cause: error });
  throw error;
}

export async function registerExternalAgentMember(
  rawActor: z.input<typeof WorkspaceActorSchema>,
  raw: z.input<typeof ExternalAgentRegistrationSchema>
) {
  const actor = humanActor(rawActor);
  const parsed = ExternalAgentRegistrationSchema.safeParse(raw);
  if (!parsed.success)
    throw new ExternalAgentMemberError("invalid_input", {
      cause: parsed.error,
    });
  const input = parsed.data;
  try {
    validateUsername(input.username);
  } catch (error) {
    if (error instanceof DirectoryError)
      throw new ExternalAgentMemberError("invalid_input", { cause: error });
    throw error;
  }
  const requestHash = createHash("sha256")
    .update(
      JSON.stringify([
        1,
        actor.workspaceId,
        actor.userId,
        input.username,
        input.name,
        input.description,
      ])
    )
    .digest("hex");
  return transaction(async () => {
    await requireWorkspaceAccess(actor, true);
    await query(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([
        actor.workspaceId,
        actor.userId,
        input.operationId,
      ])}, 23))`
    );
    const receipt = async () =>
      (
        await query(sql`SELECT ${columns}, registration_request_hash AS "registrationRequestHash"
      FROM workspace_agent_members WHERE workspace_id = ${actor.workspaceId} AND created_by = ${actor.userId}
        AND registration_operation_id = ${input.operationId} FOR SHARE`)
      )[0];
    const replay = (row: unknown) => {
      const stored = receiptSchema.parse(row);
      if (stored.registrationRequestHash !== requestHash)
        throw new ExternalAgentMemberError("conflict");
      return { applied: false, member: projectMember(stored) };
    };
    const prior = await receipt();
    if (prior) return replay(prior);
    const collisions = await query(sql`SELECT 1 FROM user_directory d
      LEFT JOIN workspace_memberships w ON w.user_id = ('better-auth:' || d.user_id)
      WHERE d.username = ${input.username} AND (d.kind = 'bot' OR w.workspace_id = ${actor.workspaceId})
      UNION ALL SELECT 1 FROM workspace_bots b
      WHERE b.workspace_id = ${actor.workspaceId} AND b.username = ${input.username} LIMIT 1`);
    if (collisions.length) throw new ExternalAgentMemberError("conflict");
    const inserted = await query(sql`INSERT INTO workspace_agent_members
      (workspace_id, username, name, description, created_by, registration_operation_id, registration_request_hash)
      VALUES (${actor.workspaceId}, ${input.username}, ${input.name}, ${input.description}, ${actor.userId}, ${input.operationId}, ${requestHash})
      ON CONFLICT (workspace_id, created_by, registration_operation_id) DO NOTHING RETURNING ${columns}`);
    if (inserted[0])
      return { applied: true, member: projectMember(inserted[0]) };
    const raced = await receipt();
    if (!raced) throw new ExternalAgentMemberError("unavailable");
    return replay(raced);
  }).catch(memberFailure);
}

export async function listExternalAgentMembers(
  rawActor: z.input<typeof WorkspaceActorSchema>,
  raw: z.input<typeof ExternalAgentListSchema>
) {
  const actor = humanActor(rawActor);
  const parsed = ExternalAgentListSchema.safeParse(raw);
  if (!parsed.success)
    throw new ExternalAgentMemberError("invalid_input", {
      cause: parsed.error,
    });
  const input = parsed.data;
  return transaction(async () => {
    await requireWorkspaceAccess(actor);
    const rows = await query(sql`SELECT ${columns} FROM workspace_agent_members
      WHERE workspace_id = ${actor.workspaceId} ${input.cursor ? sql`AND id > ${input.cursor}::uuid` : sql``}
      ORDER BY id LIMIT ${input.limit + 1}`);
    const members = rows.slice(0, input.limit).map(projectMember);
    return {
      members,
      nextCursor:
        rows.length > input.limit ? (members.at(-1)?.id ?? null) : null,
    };
  }).catch(memberFailure);
}
