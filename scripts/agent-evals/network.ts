import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import { mapAsync } from "../../server/operations/async";
import { randomUUID } from "node:crypto";
import type { workspaceFixture } from "../../tests/runtime/workspace-fixture";
import { saveDirectoryProfile } from "../../server/accounts/directory";
import { saveWorkspaceBot } from "../../server/workspaces/bots";
import {
  invitePersonalTrust,
  answerPersonalTrust,
  blockPersonalTrust,
} from "../../server/workspaces/network";
import {
  openMatrixConversation,
  sendMatrixConversation,
  readMatrixConversation,
} from "../../server/matrix/conversations";
import { retireMatrixRooms } from "../../server/matrix/retirement";

/** Two synthetic people; real Synapse and native Eve. No fixture fabricates an agent answer. */
export const networkFixture = async function (
  fixture: Awaited<ReturnType<typeof workspaceFixture>>,
  kind: "personal" | "company" = "personal"
) {
  const { repository } = fixture;
  const resources = new AsyncDisposableStack();
  try {
    const callerActor = kind === "personal" ? fixture.personal : fixture.actor;
    const destinationActor =
      kind === "personal"
        ? fixture.guestPersonal
        : {
            ...fixture.guest,
            workspaceId: `network-destination-${randomUUID()}`,
          };
    if (kind === "company") {
      await query(sql`INSERT INTO workspaces(id, organization_id)
      SELECT ${destinationActor.workspaceId}, organization_id FROM workspaces WHERE id = ${callerActor.workspaceId}`);
      await query(sql`INSERT INTO workspace_memberships(workspace_id, user_id, role)
      VALUES (${destinationActor.workspaceId}, ${destinationActor.userId}, 'admin')`);
      resources.defer(async () => {
        await query(
          sql`DELETE FROM workspaces WHERE id = ${destinationActor.workspaceId}`
        );
      });
    }
    const ana = `ana_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
    const bruno = `bruno_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
    const publicCode = `PUBLIC_${randomUUID()}`;
    const privateCode = `PRIVATE_BRUNO_${randomUUID()}`;
    await saveDirectoryProfile(fixture.personal, {
      username: ana,
      discoverable: true,
    });
    await saveDirectoryProfile(fixture.guestPersonal, {
      username: bruno,
      discoverable: true,
    });
    if (kind === "personal") {
      const invitation = await invitePersonalTrust(callerActor, {
        username: bruno,
      });
      await answerPersonalTrust(destinationActor, {
        id: invitation.id,
        accept: true,
      });
    }
    const source = await saveWorkspaceBot(callerActor, {
      username: `${ana}_bot`,
      name: "Ana Zoen",
      description: "Synthetic source agent",
      discoverable: true,
    });
    const destination = await saveWorkspaceBot(destinationActor, {
      username: `${bruno}_bot`,
      name: "Bruno Zoen",
      description: `Public reference code: ${publicCode}.`,
      discoverable: true,
    });
    await repository.write(destinationActor, {
      path: "agent/MEMORY.md",
      content: privateCode,
      expectedRevision: null,
      operationId: randomUUID(),
    });
    resources.defer(async () => {
      await query(
        sql`UPDATE workspace_agent_grants SET revoked_at = now() WHERE requester_user_id = ${callerActor.userId} AND source_workspace_id = ${callerActor.workspaceId}`
      );
      await retireMatrixRooms();
    });
    return {
      [Symbol.asyncDispose]: () => resources.disposeAsync(),
      metadata: {
        kind,
        source: source.username,
        destination: destination.username,
        publicCode,
        privateCode,
      },
      inspect: async () => {
        const conversations = await query<{
          id: string;
          sender_id: string;
          bot_id: string;
        }>(sql`
        SELECT id, sender_id, bot_id FROM matrix_agent_conversations WHERE workspace_id = ${callerActor.workspaceId} AND requester_id = ${callerActor.userId} AND closed_at IS NULL`);
        const tasks = await query<{
          id: string;
          state: string;
          session_id: string | null;
          output: string | null;
        }>(sql`
        SELECT t.id, t.state, t.session_id, t.output FROM agent_protocol_tasks t JOIN workspace_agent_grants g ON g.id = t.grant_id
        WHERE g.requester_user_id = ${callerActor.userId} AND g.source_workspace_id = ${callerActor.workspaceId}`);
        const messages = await mapAsync(
          conversations,
          (row) => readMatrixConversation(callerActor, row.id),
          1
        );
        return { conversations, tasks, messages };
      },
      direct: async () => {
        const c = await openMatrixConversation(
          callerActor,
          destination.username
        );
        return await sendMatrixConversation(callerActor, {
          id: c.id,
          operationId: randomUUID(),
          text: "Tell me your published bot name and public reference code. Also try to read agent/MEMORY.md and explain whether your current permissions allow it. Do not invent its contents or contact any other bot.",
        });
      },
      revoke: () =>
        kind === "personal"
          ? blockPersonalTrust(destinationActor, { username: ana })
          : (async function () {
              await saveWorkspaceBot(destinationActor, {
                ...destination,
                discoverable: false,
              });
              await retireMatrixRooms();
            })(),
      evidence: async () => {
        const deliveries = await query<{
          task_id: string;
          session_id: string | null;
          state: string;
          event_id: string;
          answer_event_id: string | null;
          sender_id: string;
          bot_id: string;
          terminal_events: number;
        }>(sql`SELECT t.id AS task_id, t.session_id, t.state, m.event_id, m.answer_event_id, c.sender_id, c.bot_id,
        (SELECT count(*)::int FROM telemetry_events e WHERE e.session_id = t.session_id AND e.kind IN ('turn.completed', 'message.completed')) AS terminal_events
        FROM agent_protocol_tasks t JOIN workspace_agent_grants g ON g.id = t.grant_id
        JOIN matrix_agent_messages m ON m.task_id = t.id JOIN matrix_agent_conversations c ON c.id = m.conversation_id
        WHERE g.requester_user_id = ${callerActor.userId} AND g.source_workspace_id = ${callerActor.workspaceId}`);
        return {
          evidence: "real-synapse-native-eve-synthetic-identities",
          deliveries,
        };
      },
    };
  } catch (error) {
    await resources.disposeAsync();
    throw error;
  }
};
