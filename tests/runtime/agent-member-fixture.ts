import { createHash, randomUUID } from "node:crypto";
import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { registerExternalAgentMember } from "../../server/workspaces/agent-members";
import {
  authenticateAgentGrant,
  saveWorkspaceBot,
  type AgentGrantInputSchema,
} from "../../server/workspaces/bots";
import type {
  requireWorkspaceAccess,
  workspaceActorFromPrincipal,
} from "../../server/workspaces/access";
import { matrixConfiguration } from "../../server/matrix/client";
import { requireMatrixRoom } from "../../server/matrix/rooms";
import { requireRuntimeDatabase } from "./database";
import { workspaceFixture } from "./workspace-fixture";

// Public, fixed, unusable-outside-this-disposable-fixture bearer values. Never issue credentials.
const bearers = {
  files: `Bearer zoen_a2a_${"A".repeat(43)}`,
  ontology: `Bearer zoen_a2a_${"B".repeat(43)}`,
  replacement: `Bearer zoen_a2a_${"C".repeat(43)}`,
  other: `Bearer zoen_a2a_${"D".repeat(43)}`,
};

export async function agentMemberFixture() {
  // Guard before creating any rows, independently of the suite's beforeAll guard.
  await requireRuntimeDatabase();
  const workspace = await workspaceFixture();
  const resources = new AsyncDisposableStack();
  const identities = new Set<string>();
  const sessions = new Set<string>();
  resources.defer(async () => {
    await requireRuntimeDatabase();
    for (const principal of identities)
      await query(
        sql`DELETE FROM matrix_identities WHERE user_id = ${principal}`
      );
    // Workspace cascade can enqueue cancellations, so these exact fixture receipts are removed last.
    for (const sessionId of sessions)
      await query(
        sql`DELETE FROM agent_protocol_cancellations WHERE session_id = ${sessionId}`
      );
  });
  resources.defer(async () => {
    await requireRuntimeDatabase();
    await workspace[Symbol.asyncDispose]();
  });
  try {
    const bot = await saveWorkspaceBot(workspace.actor, {
      username: `b${randomUUID().replaceAll("-", "").slice(0, 20)}`,
      name: "Synthetic agent-member recipient",
      description: "Isolated fixture; no native runtime",
      discoverable: false,
    });
    return {
      ...workspace,
      [Symbol.asyncDispose]: () => resources.disposeAsync(),
      bot,
      async grant(
        member: Awaited<
          ReturnType<typeof registerExternalAgentMember>
        >["member"],
        capabilities: z.output<typeof AgentGrantInputSchema>["capabilities"],
        slot: keyof typeof bearers
      ) {
        const bearer = bearers[slot];
        const rows = await query(sql`INSERT INTO workspace_agent_grants
          (bot_id, issued_by, external_member_id, label, token_hash, capabilities, expires_at)
          VALUES (${bot.id}, ${workspace.actor.userId}, ${member.id}, ${`Synthetic ${slot}`},
            ${createHash("sha256").update(bearer.slice(7)).digest("hex")},
            ${JSON.stringify(capabilities)}::jsonb, clock_timestamp() + interval '1 hour') RETURNING id`);
        const id = z.uuid().parse(rows[0]?.id);
        const { actor } = await authenticateAgentGrant(bearer, bot.username);
        return { id, bearer, actor };
      },
      sessionId() {
        const id = `agent-member-fixture:${randomUUID()}`;
        sessions.add(id);
        return id;
      },
      async room(
        members: Awaited<
          ReturnType<typeof registerExternalAgentMember>
        >["member"][]
      ) {
        // Seed existing native projections only. No Synapse registration, joining, or sends occur.
        const config = await matrixConfiguration();
        const id = randomUUID();
        const roomId = `!agent-member-fixture-${id}:${config.serverName}`;
        await query(sql`INSERT INTO workspace_group_bindings
          (id, workspace_id, channel, installation_id, conversation_id, label, created_by)
          VALUES (${id}, ${workspace.actor.workspaceId}, 'matrix', ${config.serverName},
            ${roomId}, 'Synthetic agent-member room', ${workspace.actor.userId})`);
        const authorId = `@_zoen_${createHash("sha256").update(workspace.actor.userId).digest("hex").slice(0, 32)}:${config.serverName}`;
        const people = [
          {
            principal: workspace.actor.userId,
            matrixId: authorId,
            name: "Synthetic owner",
          },
          ...members.map((member) => ({
            principal: member.principal,
            matrixId: `@_zoen_agent_${member.id.replaceAll("-", "")}:${config.serverName}`,
            name: member.name,
          })),
        ];
        for (const person of people) {
          identities.add(person.principal);
          await query(sql`INSERT INTO matrix_identities (user_id, matrix_id, display_name)
            VALUES (${person.principal}, ${person.matrixId}, ${person.name}) ON CONFLICT (user_id) DO NOTHING`);
          await query(sql`INSERT INTO matrix_room_members (binding_id, user_id)
            VALUES (${id}, ${person.principal})`);
        }
        return {
          ...(await requireMatrixRoom(workspace.actor, id)),
          matrixId: authorId,
        };
      },
    };
  } catch (error) {
    await resources.disposeAsync();
    throw error;
  }
}

export function agentPrincipalFor(
  actor: Parameters<typeof requireWorkspaceAccess>[0],
  taskId?: string
): NonNullable<Parameters<typeof workspaceActorFromPrincipal>[0]> {
  return {
    principalType: "service",
    principalId: actor.userId,
    authenticator: "a2a",
    attributes: {
      workspaceId: actor.workspaceId,
      agentGrantId: z.uuid().parse(actor.agentGrantId),
      ...(taskId ? { protocolTaskId: taskId } : {}),
      conversationChannel: "a2a",
    },
  };
}
