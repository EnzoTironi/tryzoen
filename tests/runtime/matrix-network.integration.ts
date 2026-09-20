import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import { sleep } from "../../server/operations/async";
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, expect, test, onTestFinished } from "vitest";

import { workspaceFixture, workspaceExecutionFor } from "./workspace-fixture";
import { nativeContext } from "../helpers/native-tools";
import { resolveCapabilities } from "../../server/tools/catalog";

import { matrixReceiver } from "./matrix-fixture";

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
  closeMatrixConversation,
} from "../../server/matrix/conversations";
import {
  matrixProtocolTask,
  publishMatrixProtocolAnswer,
} from "../../server/matrix/network-delivery";
import {
  finishProtocolTask,
  cancelProtocolTask,
  readProtocolTask,
  bindProtocolSession,
} from "../../server/a2a/tasks";
import { retireMatrixRooms } from "../../server/matrix/retirement";
import { readMatrixResult } from "../../server/matrix/result";
import { telemetryScope } from "../../server/observability/principal";
import { matrixRequest } from "../../server/matrix/client";
import { acceptMatrixTransaction } from "../../server/matrix/inbound";
import { removeWorkspaceMember } from "../../server/workspaces/team";

let receiver: Awaited<ReturnType<typeof matrixReceiver>>;
beforeAll(async () => {
  receiver = await matrixReceiver();
});
afterAll(async () => {
  await receiver.close();
});
const profile = (name: string) => ({
  name,
  username: `b${randomUUID().replaceAll("-", "").slice(0, 20)}`,
  description: "Public synthetic bot profile",
  discoverable: true,
});
const fixture = async () => {
  const f = await workspaceFixture();
  onTestFinished(() => f[Symbol.asyncDispose]());
  const ana = `a${randomUUID().replaceAll("-", "").slice(0, 20)}`;
  const bruno = `b${randomUUID().replaceAll("-", "").slice(0, 20)}`;
  await saveDirectoryProfile(f.personal, {
    username: ana,
    discoverable: true,
  });
  await saveDirectoryProfile(f.guestPersonal, {
    username: bruno,
    discoverable: true,
  });
  const invited = await invitePersonalTrust(f.personal, { username: bruno });
  await answerPersonalTrust(f.guestPersonal, { id: invited.id, accept: true });
  const anaBot = await saveWorkspaceBot(f.personal, profile("Ana Zoen"));
  const brunoBot = await saveWorkspaceBot(
    f.guestPersonal,
    profile("Bruno Zoen")
  );
  return { ...f, ana, bruno, anaBot, brunoBot };
};
const receivedTask = async (id: string) => {
  for (let n = 0; n < 150; n++) {
    const task = await matrixProtocolTask(id);
    if (task) return task;
    await sleep(100);
  }
  throw new Error("Synapse did not produce a persisted A2A task");
};

test(
  "real Synapse routes a trusted human to the target bot through one A2A task",
  { timeout: 60000 },
  async () => {
    const { personal, guestPersonal, brunoBot } = await fixture();
    const execution = workspaceExecutionFor(personal);
    const tools = await resolveCapabilities(nativeContext(execution));
    expect(tools["network-contact"]?.approval).toBeDefined();
    expect(
      await query(
        sql`SELECT id FROM matrix_agent_conversations WHERE workspace_id = ${personal.workspaceId}`
      )
    ).toHaveLength(0);
    const room = await openMatrixConversation(personal, brunoBot.username);
    expect((await openMatrixConversation(personal, brunoBot.username)).id).toBe(
      room.id
    );
    expect(
      !(
        await Promise.try(async () =>
          readMatrixConversation(guestPersonal, room.id)
        ).then(
          (value) => ({ ok: true as const, value }),
          (error: unknown) => ({ ok: false as const, error })
        )
      ).ok
    ).toBe(true);
    const input = {
      id: room.id,
      operationId: randomUUID(),
      text: "Olá, Bruno.",
    };
    const event = await sendMatrixConversation(personal, input);
    expect(await sendMatrixConversation(personal, input)).toEqual(event);
    expect(
      !(
        await Promise.try(async () =>
          sendMatrixConversation(personal, {
            ...input,
            text: "Changed payload",
          })
        ).then(
          (value) => ({ ok: true as const, value }),
          (error: unknown) => ({ ok: false as const, error })
        )
      ).ok
    ).toBe(true);
    const { taskId, destActor } = await receivedTask(event.event_id);
    const captured = receiver.receipts.find((r) =>
      r.body.includes(event.event_id)
    );
    expect(captured).toBeDefined();
    if (!captured) throw new Error("Missing real homeserver event");
    await acceptMatrixTransaction(
      new Request("http://localhost/transactions", {
        method: "PUT",
        headers: { authorization: captured.authorization },
        body: captured.body,
      }),
      captured.id
    );
    expect(
      await query(
        sql`SELECT id FROM agent_protocol_tasks WHERE grant_id = ${room.grantId}`
      )
    ).toHaveLength(1);
    expect((await readProtocolTask(destActor, taskId)).prompt).toBe(input.text);
    const nativeSession = `synthetic-telemetry-${randomUUID()}`;
    await bindProtocolSession(destActor, taskId, nativeSession);
    const delegatedPrincipal = {
      principalId: destActor.userId,
      principalType: "user",
      authenticator: "a2a",
      attributes: {
        workspaceId: destActor.workspaceId,
        agentGrantId: destActor.agentGrantId,
        protocolTaskId: taskId,
      },
    };
    const delegatedCatalog = await resolveCapabilities(
      nativeContext({
        session: {
          ...execution.session,
          auth: {
            current: delegatedPrincipal,
            initiator: delegatedPrincipal,
          },
        },
      })
    );
    expect(Object.keys(delegatedCatalog)).not.toContain("network-contact");
    expect(Object.keys(delegatedCatalog)).not.toContain("network-bots");
    // This is a transport/authorization proof; native model behavior has a separate eval.
    await finishProtocolTask(
      destActor,
      taskId,
      "TASK_STATE_COMPLETED",
      "Resposta de transporte do Bruno."
    );
    await publishMatrixProtocolAnswer(taskId);
    await publishMatrixProtocolAnswer(taskId);
    const principal = {
      principalType: "user",
      principalId: destActor.userId,
      authenticator: "a2a",
      attributes: {
        workspaceId: destActor.workspaceId,
        agentGrantId: destActor.agentGrantId,
        protocolTaskId: taskId,
      },
    };
    expect((await telemetryScope(principal, nativeSession)).workspaceId).toBe(
      destActor.workspaceId
    );
    expect(
      !(
        await Promise.try(async () =>
          telemetryScope(principal, "other-native-session")
        ).then(
          (value) => ({ ok: true as const, value }),
          (error: unknown) => ({ ok: false as const, error })
        )
      ).ok
    ).toBe(true);
    const view = await readMatrixConversation(personal, room.id);
    expect(view.messages.map((m) => [m.fromBot, m.text])).toEqual([
      [false, input.text],
      [true, "Resposta de transporte do Bruno."],
    ]);
    expect(
      (await readMatrixResult(personal, room.id, event.event_id)).text
    ).toBe("Resposta de transporte do Bruno.");
    expect(
      !(
        await Promise.try(async () =>
          readMatrixResult(guestPersonal, room.id, event.event_id)
        ).then(
          (value) => ({ ok: true as const, value }),
          (error: unknown) => ({ ok: false as const, error })
        )
      ).ok
    ).toBe(true);
    expect(room.senderId).not.toBe(room.botId);
    const history = await matrixRequest(
      "GET",
      `rooms/${encodeURIComponent(room.roomId)}/state/m.room.history_visibility`,
      undefined,
      room.senderId
    );
    expect(history).toEqual({ history_visibility: "joined" });
    const followup = await sendMatrixConversation(personal, {
      id: room.id,
      operationId: randomUUID(),
      text: "Continue the previous answer.",
    });
    const followupTask = await receivedTask(followup.event_id);
    const continued = await readProtocolTask(
      followupTask.destActor,
      followupTask.taskId
    );
    expect(continued.prompt).toContain("Resposta de transporte do Bruno.");
    expect(continued.prompt).toContain("Continue the previous answer.");
    expect(continued.prompt).toContain("untrusted context");
  }
);

test(
  "distinct source/destination bots use Matrix identities and cancellation suppresses late results",
  { timeout: 60000 },
  async () => {
    const { personal, brunoBot } = await fixture();
    const human = await openMatrixConversation(personal, brunoBot.username);
    const agent = await openMatrixConversation(
      personal,
      brunoBot.username,
      true
    );
    expect(agent.senderId).toContain("@_zoen_agent_");
    expect(agent.botId).toContain("@_zoen_agent_");
    expect(agent.senderId).not.toBe(agent.botId);
    expect(agent.roomId).not.toBe(human.roomId);
    const event = await sendMatrixConversation(personal, {
      id: agent.id,
      operationId: randomUUID(),
      text: "A tarefa do bot de Ana.",
    });
    const { taskId, destActor } = await receivedTask(event.event_id);
    const nativeSession = `synthetic-cancel-${randomUUID()}`;
    await bindProtocolSession(destActor, taskId, nativeSession);
    await cancelProtocolTask(destActor, taskId);
    expect(
      await query(
        sql`SELECT session_id FROM agent_protocol_cancellations WHERE session_id = ${nativeSession}`
      )
    ).toHaveLength(1);
    await query(
      sql`DELETE FROM agent_protocol_cancellations WHERE session_id = ${nativeSession}`
    );
    await finishProtocolTask(
      destActor,
      taskId,
      "TASK_STATE_COMPLETED",
      "Late result must not appear"
    );
    await publishMatrixProtocolAnswer(taskId);
    expect(
      (await readMatrixConversation(personal, agent.id)).messages
    ).toHaveLength(1);
    expect((await readProtocolTask(destActor, taskId)).state).toBe(
      "TASK_STATE_CANCELED"
    );
    await closeMatrixConversation(personal, agent.id);
    await closeMatrixConversation(personal, agent.id);
    expect(
      await query(
        sql`SELECT room_id FROM matrix_room_retirements WHERE room_id = ${agent.roomId}`
      )
    ).toHaveLength(1);
    await retireMatrixRooms();
    const joined = await matrixRequest(
      "GET",
      "joined_rooms",
      undefined,
      agent.senderId
    );
    expect(JSON.stringify(joined)).not.toContain(agent.roomId);
  }
);

test(
  "blocking a peer prevents reads, sends and pending A2A output",
  { timeout: 60000 },
  async () => {
    const { personal, guestPersonal, ana, brunoBot } = await fixture();
    const room = await openMatrixConversation(personal, brunoBot.username);
    const event = await sendMatrixConversation(personal, {
      id: room.id,
      operationId: randomUUID(),
      text: "Before revoke",
    });
    const { taskId, destActor } = await receivedTask(event.event_id);
    await blockPersonalTrust(guestPersonal, { username: ana });
    expect(
      !(
        await Promise.try(async () =>
          readMatrixConversation(personal, room.id)
        ).then(
          (value) => ({ ok: true as const, value }),
          (error: unknown) => ({ ok: false as const, error })
        )
      ).ok
    ).toBe(true);
    expect(
      !(
        await Promise.try(async () =>
          sendMatrixConversation(personal, {
            id: room.id,
            operationId: randomUUID(),
            text: "After revoke",
          })
        ).then(
          (value) => ({ ok: true as const, value }),
          (error: unknown) => ({ ok: false as const, error })
        )
      ).ok
    ).toBe(true);
    expect(
      !(
        await Promise.try(async () =>
          finishProtocolTask(
            destActor,
            taskId,
            "TASK_STATE_COMPLETED",
            "Do not deliver"
          )
        ).then(
          (value) => ({ ok: true as const, value }),
          (error: unknown) => ({ ok: false as const, error })
        )
      ).ok
    ).toBe(true);
    expect(
      !(
        await Promise.try(async () => publishMatrixProtocolAnswer(taskId)).then(
          (value) => ({ ok: true as const, value }),
          (error: unknown) => ({ ok: false as const, error })
        )
      ).ok
    ).toBe(true);
  }
);

test(
  "removal from the source project destroys its grant even if company membership remains",
  { timeout: 60000 },
  async () => {
    await using workspace = await workspaceFixture();
    const { actor, guest } = workspace;
    const bot = await saveWorkspaceBot(actor, profile("Company Zoen"));
    const room = await openMatrixConversation(guest, bot.username);
    const event = await sendMatrixConversation(guest, {
      id: room.id,
      operationId: randomUUID(),
      text: "Project request",
    });
    const { taskId, destActor } = await receivedTask(event.event_id);
    const nativeSession = `synthetic-remove-${randomUUID()}`;
    await bindProtocolSession(destActor, taskId, nativeSession);
    await removeWorkspaceMember(actor, guest.userId);
    expect(
      await query(
        sql`SELECT session_id FROM agent_protocol_cancellations WHERE session_id = ${nativeSession}`
      )
    ).toHaveLength(1);
    await query(
      sql`DELETE FROM agent_protocol_cancellations WHERE session_id = ${nativeSession}`
    );
    expect(
      await query(
        sql`SELECT room_id FROM matrix_room_retirements WHERE room_id = ${room.roomId}`
      )
    ).toHaveLength(1);
    expect(
      await query(
        sql`SELECT 1 FROM organization_memberships WHERE user_id = ${guest.userId}`
      )
    ).toHaveLength(1);
    expect(
      await query(
        sql`SELECT 1 FROM workspace_agent_grants WHERE id = ${room.grantId}`
      )
    ).toHaveLength(0);
    expect(
      !(
        await Promise.try(async () => readProtocolTask(destActor, taskId)).then(
          (value) => ({ ok: true as const, value }),
          (error: unknown) => ({ ok: false as const, error })
        )
      ).ok
    ).toBe(true);
  }
);
