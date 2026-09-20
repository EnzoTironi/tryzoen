import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { afterAll, beforeAll, expect, test } from "vitest";
import { query } from "@db/queries";
import { env } from "@shared/environment/env";
import { buildEveFixture, clearFixtureWorkflows, runtime } from "./eve-fixture";
import { workspaceFixture, workspaceExecutionFor } from "./workspace-fixture";
import { wakeMatrixService } from "./matrix-fixture";
import {
  createMatrixRoom,
  readMatrixMessages,
  sendMatrixMessage,
  closeMatrixRoom,
  reconcileMatrixRooms,
} from "../../server/matrix/rooms";
import { matrixRequest } from "../../server/matrix/client";
import { removeWorkspaceMember } from "../../server/workspaces/team";
import { readNativeReceipt } from "../../server/messaging/native-receipts";

beforeAll(buildEveFixture, 65_000);
afterAll(clearFixtureWorkflows);

let matrixAwake = false;
async function groupRuntime() {
  const server = await runtime(4350, "0.0.0.0");
  if (!matrixAwake) {
    await wakeMatrixService();
    matrixAwake = true;
  }
  return server;
}

test("real group conversation executes workspace tools, retains shared context and isolates each member's private data", async () => {
  await using workspace = await workspaceFixture();
  const { actor, guest, personal, repository } = workspace;
  const server = await groupRuntime();
  const privateAuth = workspaceExecutionFor(personal).session.auth.current;
  const privateSession = z.object({ sessionId: z.string() }).parse(
    await server.request("/probe/send", {
      address: randomUUID(),
      id: randomUUID(),
      message: "remember",
      auth: {
        ...privateAuth,
        attributes: { ...privateAuth.attributes, memoryProof: "enabled" },
      },
    })
  );
  expect(
    JSON.stringify(await server.settled(privateSession.sessionId))
  ).toContain("Synthetic favorite color: orange");
  await repository.write(personal, {
    operationId: randomUUID(),
    expectedRevision: null,
    path: "knowledge/private-canary.md",
    content: "PRIVATE-GROUP-ISOLATION-CANARY",
  });
  const room = await createMatrixRoom(actor, {
    operationId: randomUUID(),
    name: "Synthetic functional group",
  });
  try {
    await readMatrixMessages(actor, room.id);
    await readMatrixMessages(guest, room.id);
    const chatter = await sendMatrixMessage(actor, {
      id: room.id,
      operationId: randomUUID(),
      text: "GROUP-CONTEXT-CANARY: launch on Friday.",
    });
    // A processed provider event without an explicit invocation must not start an agent turn.
    await expect
      .poll(
        async () =>
          (
            await query(
              sql`SELECT id FROM matrix_received_events WHERE id = ${chatter.event_id}`
            )
          ).length,
        { timeout: 30_000, interval: 100 }
      )
      .toBe(1);
    expect(
      await query(
        sql`SELECT event_id FROM matrix_deliveries WHERE event_id = ${chatter.event_id}`
      )
    ).toHaveLength(0);

    const operationId: string = randomUUID();
    const write = await sendMatrixMessage(guest, {
      id: room.id,
      operationId,
      text: "@Zoen group-save",
    });
    expect(
      await sendMatrixMessage(guest, {
        id: room.id,
        operationId,
        text: "@Zoen group-save",
      })
    ).toEqual(write);
    await expect
      .poll(
        async () =>
          (
            await query<{ state: string }>(
              sql`SELECT state FROM matrix_deliveries WHERE event_id = ${write.event_id}`
            )
          )[0]?.state,
        { timeout: 30_000 }
      )
      .toBe("completed");
    const receipt = (
      await query<{ sessionId: string; userId: string }>(
        sql`SELECT session_id AS "sessionId", user_id AS "userId" FROM matrix_deliveries WHERE event_id = ${write.event_id}`
      )
    )[0];
    expect(receipt?.userId).toBe(guest.userId);
    if (!receipt) throw new Error("Missing group Eve session");
    const events = await server.settled(receipt.sessionId);
    expect(JSON.stringify(events)).toContain("workspace_files_list");
    expect(JSON.stringify(events)).toContain("workspace-save");
    expect(
      (await repository.read(actor, "knowledge/group-decision.md")).content
    ).toBe("The shared release decision is Friday.");
    expect(
      await repository.history(actor, "knowledge/group-decision.md")
    ).toHaveLength(1);
    expect(
      (await readMatrixMessages(actor, room.id)).messages.filter(
        (message) => message.sender === "Zoen"
      )
    ).toHaveLength(1);

    const followup = await sendMatrixMessage(actor, {
      id: room.id,
      operationId: randomUUID(),
      text: "@Zoen group-recall",
    });
    await expect
      .poll(
        async () =>
          (
            await query<{ state: string }>(
              sql`SELECT state FROM matrix_deliveries WHERE event_id = ${followup.event_id}`
            )
          )[0]?.state,
        { timeout: 30_000 }
      )
      .toBe("completed");
    const view = await readMatrixMessages(guest, room.id);
    const answers = view.messages.filter(
      (message) => message.sender === "Zoen"
    );
    const answer = answers.at(-1)?.text ?? "";
    expect(answers).toHaveLength(2);
    expect(answer).toContain("GROUP-CONTEXT-CANARY");
    expect(answer).toContain("Saved shared decision.");
    expect(answer).toContain("The shared release decision is Friday.");
    expect(answer).not.toContain("PRIVATE-GROUP-ISOLATION-CANARY");
    expect(answer).not.toContain("Synthetic favorite color: orange");
    const modelView = z
      .object({ tools: z.array(z.string()) })
      .parse(JSON.parse(answer));
    expect(modelView.tools).not.toContain("workspace_memory_search");
    expect(modelView.tools).not.toContain("profile__save_memory");
    expect(modelView.tools).not.toContain("personal-memory-inspect");
    const reply = z
      .object({
        content: z.object({
          "m.relates_to": z.object({
            "m.in_reply_to": z.object({ event_id: z.string() }),
          }),
        }),
      })
      .parse(
        await matrixRequest(
          "GET",
          `rooms/${encodeURIComponent(room.roomId)}/event/${encodeURIComponent(answers.at(-1)?.id ?? "")}`
        )
      );
    expect(reply.content["m.relates_to"]["m.in_reply_to"].event_id).toBe(
      followup.event_id
    );

    const nativeMessage = await sendMatrixMessage(guest, {
      id: room.id,
      operationId: randomUUID(),
      text: "@Zoen group-message",
    });
    await waitForMatrixState(nativeMessage.event_id, "completed");
    const nativeMessages = (await readMatrixMessages(actor, room.id)).messages;
    expect(
      nativeMessages.filter(
        (message) => message.text === "Native group message."
      )
    ).toHaveLength(1);
    expect(
      nativeMessages.some((message) => message.text === "DELIVERY_COMPLETE")
    ).toBe(false);
    expect(
      nativeMessages.some((message) =>
        ["Native message preamble.", "Native message follow-up."].includes(
          message.text
        )
      )
    ).toBe(false);
    expect(
      nativeMessages.find((message) => message.id === nativeMessage.event_id)
        ?.reactions
    ).toContainEqual({ type: "heart", count: 1 });
    const reactions = z
      .object({
        chunk: z.array(
          z.object({
            content: z.object({
              "m.relates_to": z.object({
                key: z.string(),
                event_id: z.string(),
              }),
            }),
          })
        ),
      })
      .parse(
        await matrixRequest(
          "GET",
          `rooms/${encodeURIComponent(room.roomId)}/messages?dir=b&limit=40&filter=${encodeURIComponent(JSON.stringify({ types: ["m.reaction"] }))}`
        )
      );
    expect(
      reactions.chunk.map((event) => event.content["m.relates_to"])
    ).toContainEqual({ key: "❤️", event_id: nativeMessage.event_id });
    await replayMatrixEvent(room.roomId, nativeMessage.event_id);
    expect(
      (await readMatrixMessages(actor, room.id)).messages.filter(
        (message) => message.text === "Native group message."
      )
    ).toHaveLength(1);

    const botMessagesBeforeReaction = (
      await readMatrixMessages(actor, room.id)
    ).messages.filter((message) => message.sender === "Zoen").length;
    const reactionOnly = await sendMatrixMessage(guest, {
      id: room.id,
      operationId: randomUUID(),
      text: "@Zoen group-react-only",
    });
    await waitForMatrixState(reactionOnly.event_id, "completed");
    const afterReaction = (await readMatrixMessages(actor, room.id)).messages;
    expect(
      afterReaction.filter((message) => message.sender === "Zoen")
    ).toHaveLength(botMessagesBeforeReaction);
    expect(
      afterReaction.find((message) => message.id === reactionOnly.event_id)
        ?.reactions
    ).toContainEqual({ type: "heart", count: 1 });

    const question = await sendMatrixMessage(guest, {
      id: room.id,
      operationId: randomUUID(),
      text: "@Zoen group-question",
    });
    await waitForMatrixState(question.event_id, "dispatched");
    await expect
      .poll(
        async () =>
          (await readMatrixMessages(guest, room.id)).messages.some(
            (message) =>
              message.sender === "Zoen" &&
              message.text.includes("Which release day?")
          ),
        { timeout: 30_000 }
      )
      .toBe(true);
    const answerEvent = await sendMatrixMessage(guest, {
      id: room.id,
      operationId: randomUUID(),
      text: "Zoen Friday",
    });
    await waitForMatrixState(answerEvent.event_id, "completed");
    await waitForMatrixState(question.event_id, "completed");
    expect(
      (await readMatrixMessages(actor, room.id)).messages.at(-1)?.text
    ).toContain("friday");

    await removeWorkspaceMember(actor, guest.userId);
    await expect(
      sendMatrixMessage(guest, {
        id: room.id,
        operationId: randomUUID(),
        text: "@Zoen denied",
      })
    ).rejects.toThrow("WorkspaceAccessDenied");
    await expect(readMatrixMessages(guest, room.id)).rejects.toThrow(
      "WorkspaceAccessDenied"
    );
    await reconcileMatrixRooms();
    expect(
      await query(
        sql`SELECT user_id FROM matrix_room_members WHERE binding_id = ${room.id} AND user_id = ${guest.userId}`
      )
    ).toEqual([]);
  } catch (error) {
    const sessions = await query<{ sessionId: string }>(
      sql`SELECT DISTINCT d.session_id AS "sessionId" FROM matrix_deliveries d JOIN workspace_group_bindings b ON b.id=d.binding_id WHERE b.workspace_id=${actor.workspaceId} AND d.session_id IS NOT NULL`
    );
    const traces = await Promise.all(
      sessions.map(async (row) => ({
        sessionId: row.sessionId,
        events: await server.request(`/probe/events/${row.sessionId}`),
      }))
    );
    throw new Error(JSON.stringify({ runtime: server.output(), traces }), {
      cause: error,
    });
  } finally {
    await closeMatrixRoom(actor, room.id);
    await reconcileMatrixRooms();
    await server.stop();
  }
}, 120_000);

async function replayMatrixEvent(roomId: string, eventId: string) {
  const event = await matrixRequest(
    "GET",
    `rooms/${encodeURIComponent(roomId)}/event/${encodeURIComponent(eventId)}`
  );
  const response = await fetch(
    "http://127.0.0.1:4350/_matrix/app/v1/transactions/" + randomUUID(),
    {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${z.string().parse(env.ZOEN_MATRIX_HS_TOKEN?.reveal())}`,
      },
      body: JSON.stringify({ events: [event] }),
    }
  );
  expect(response.status).toBe(200);
}

async function waitForMatrixState(eventId: string, state: string) {
  await expect
    .poll(
      async () =>
        (
          await query<{ state: string }>(
            sql`SELECT state FROM matrix_deliveries WHERE event_id = ${eventId}`
          )
        )[0]?.state,
      { timeout: 30_000 }
    )
    .toBe(state);
}

test("delivered group reactions tolerate an empty model follow-up while actual failures remain visible", async () => {
  await using workspace = await workspaceFixture();
  const { actor, repository } = workspace;
  await repository.write(actor, {
    operationId: randomUUID(),
    expectedRevision: null,
    path: "knowledge/reaction-test.md",
    content: "Shared fixture document for revision authority checks.",
  });
  const server = await groupRuntime();
  const room = await createMatrixRoom(actor, {
    operationId: randomUUID(),
    name: "Synthetic reaction failure group",
  });
  const failureText =
    "Não consegui concluir esta tarefa. Mencione Zoen para tentar novamente.";
  try {
    await readMatrixMessages(actor, room.id);
    for (const scenario of [
      { command: "group-react-empty", reaction: true, failure: false },
      { command: "group-empty", reaction: false, failure: true },
      { command: "group-react-error", reaction: true, failure: true },
      { command: "group-progress-failed-tool", reaction: false, failure: true },
    ]) {
      const before = (await readMatrixMessages(actor, room.id)).messages;
      const sent = await sendMatrixMessage(actor, {
        id: room.id,
        operationId: randomUUID(),
        text: `@Zoen ${scenario.command}`,
      });
      await waitForMatrixState(sent.event_id, "completed");
      // A fast native turn may finish before its continuation is acknowledged.
      // Its completed receipt must still acquire the exact durable session.
      await expect
        .poll(
          async () => {
            const [delivery] = await query<{
              sessionId: string | null;
              nativeSessionId: string;
            }>(sql`SELECT d.session_id AS "sessionId", n.session_id AS "nativeSessionId"
            FROM matrix_deliveries d JOIN native_delivery_receipts n ON n.input_id = d.event_id
            WHERE d.event_id = ${sent.event_id} AND n.workspace_id = ${actor.workspaceId}`);
            return (
              Boolean(delivery?.sessionId) &&
              delivery?.sessionId === delivery?.nativeSessionId
            );
          },
          { timeout: 15_000 }
        )
        .toBe(true);
      const [receipt] = await query<{
        sessionId: string;
        output: string | null;
      }>(
        sql`SELECT session_id AS "sessionId", output FROM matrix_deliveries WHERE event_id = ${sent.event_id}`
      );
      if (!receipt) throw new Error("Missing native reaction session");
      expect(receipt.sessionId).toEqual(expect.any(String));
      expect(receipt.sessionId).toBe(
        (await readNativeReceipt(actor.workspaceId, sent.event_id))?.sessionId
      );
      expect(receipt.output).toBe(scenario.failure ? failureText : null);
      // The completed receipt proves the failure hook settled. Also observe its
      // durable native event before checking egress; recoverable and terminal
      // model failures do not necessarily share the same session boundary.
      await expect
        .poll(
          async () =>
            z
              .array(z.object({ type: z.string() }))
              .parse(await server.request(`/probe/events/${receipt.sessionId}`))
              .some((event) => event.type === "turn.failed"),
          { timeout: 30_000 }
        )
        .toBe(true);
      const events = z
        .array(z.object({ type: z.string(), data: z.unknown() }))
        .parse(await server.request(`/probe/events/${receipt.sessionId}`));
      expect(
        events.map((event) => event.type),
        scenario.command
      ).toContain("turn.failed");
      const failure = z
        .object({
          code: z.string(),
          details: z
            .object({ semanticErrorId: z.string().optional() })
            .optional(),
        })
        .parse(events.find((event) => event.type === "turn.failed")?.data);
      expect(failure.code).toBe("MODEL_CALL_FAILED");
      expect(failure.details?.semanticErrorId).toBe(
        scenario.command === "group-react-error"
          ? undefined
          : "empty-model-response"
      );
      const actionResults = events
        .filter((event) => event.type === "action.result")
        .map((event) => event.data);
      expect(
        events.some(
          (event) =>
            event.type === "action.result" &&
            z.object({ status: z.string() }).parse(event.data).status ===
              "failed"
        ),
        JSON.stringify({ command: scenario.command, actions: actionResults })
      ).toBe(scenario.command === "group-progress-failed-tool");
      const messages = (await readMatrixMessages(actor, room.id)).messages;
      const newBotMessages = messages.filter(
        (message) =>
          message.sender === "Zoen" &&
          !before.some((prior) => prior.id === message.id)
      );
      expect(newBotMessages.map((message) => message.text)).toEqual(
        scenario.command === "group-progress-failed-tool"
          ? ["Synthetic progress.", failureText]
          : scenario.failure
            ? [failureText]
            : []
      );
      expect(
        messages.find((message) => message.id === sent.event_id)?.reactions
      ).toEqual(scenario.reaction ? [{ type: "heart", count: 1 }] : []);
    }
  } finally {
    await closeMatrixRoom(actor, room.id);
    await reconcileMatrixRooms();
    await server.stop();
  }
}, 120_000);

test("group approvals require the original requester, reject denial and replay, and recheck revoked membership", async () => {
  await using workspace = await workspaceFixture();
  const { actor, guest, repository } = workspace;
  const server = await groupRuntime();
  const room = await createMatrixRoom(actor, {
    operationId: randomUUID(),
    name: "Synthetic group approval",
  });
  try {
    await readMatrixMessages(actor, room.id);
    await readMatrixMessages(guest, room.id);
    // Wait for the homeserver's ordered queue, including all join/invite events.
    // Replaying only the current JOIN state would make older membership events
    // arrive later and correctly invalidate an already-pending request's epoch.
    const barrier = await sendMatrixMessage(actor, {
      id: room.id,
      operationId: randomUUID(),
      text: "Membership is ready.",
    });
    await expect
      .poll(
        async () =>
          (
            await query(
              sql`SELECT id FROM matrix_received_events WHERE id=${barrier.event_id}`
            )
          ).length,
        { timeout: 30_000, interval: 100 }
      )
      .toBe(1);
    const send = async (
      sender: Parameters<typeof sendMatrixMessage>[0],
      text: string,
      operationId: string = randomUUID()
    ) => {
      const sent = await sendMatrixMessage(sender, {
        id: room.id,
        operationId,
        text,
      });
      await replayMatrixEvent(room.roomId, sent.event_id);
      return sent;
    };
    const pending = async () => {
      const sent = await send(guest, "@Zoen group-approve");
      await waitForMatrixState(sent.event_id, "dispatched");
      const row = (
        await query<{ sessionId: string }>(
          sql`SELECT session_id AS "sessionId" FROM matrix_deliveries WHERE event_id = ${sent.event_id}`
        )
      )[0];
      if (!row) throw new Error("Missing group session");
      const events = await server.settled(row.sessionId);
      await waitForMatrixState(sent.event_id, "dispatched");
      expect(events.some((event) => event.type === "input.requested")).toBe(
        true
      );
      expect(
        events.filter((event) => event.type === "action.result")
      ).toHaveLength(0);
      const messages = (await readMatrixMessages(guest, room.id)).messages;
      expect(
        messages.some(
          (message) =>
            message.sender === "Zoen" && message.text.includes("Zoen aprovar")
        )
      ).toBe(true);
      // The event stream can park before the transport hook has posted its
      // prompt. A previous request's visible prompt is not this request's consent.
      await expect
        .poll(
          async () => {
            const timeline = z
              .object({
                chunk: z.array(
                  z.object({
                    content: z.object({
                      "dev.zoen.input": z
                        .object({ eventId: z.string() })
                        .optional(),
                    }),
                  })
                ),
              })
              .parse(
                await matrixRequest(
                  "GET",
                  `rooms/${encodeURIComponent(room.roomId)}/messages?dir=b&limit=40`
                )
              );
            return timeline.chunk.some(
              (event) =>
                event.content["dev.zoen.input"]?.eventId === sent.event_id
            );
          },
          { timeout: 15_000 }
        )
        .toBe(true);
      return { ...sent, sessionId: row.sessionId };
    };
    const denied = await pending();
    const otherMember = await send(actor, "Zoen aprovar");
    await waitForMatrixState(otherMember.event_id, "completed");
    expect(
      (await server.settled(denied.sessionId)).filter(
        (event) => event.type === "action.result"
      )
    ).toHaveLength(0);
    expect(
      await repository.history(actor, "knowledge/approved-group-action.md")
    ).toHaveLength(0);
    const cancel = await send(guest, "Zoen cancelar");
    await waitForMatrixState(cancel.event_id, "completed");
    await waitForMatrixState(denied.event_id, "completed");
    expect(
      await repository.history(actor, "knowledge/approved-group-action.md")
    ).toHaveLength(0);

    const approved = await pending();
    const operationId: string = randomUUID();
    const [consent, concurrentConsent] = await Promise.all([
      send(guest, "Zoen aprovar", operationId),
      send(guest, "Zoen aprovar"),
    ]);
    await waitForMatrixState(concurrentConsent.event_id, "completed");
    await waitForMatrixState(consent.event_id, "completed");
    await waitForMatrixState(approved.event_id, "completed");
    expect(
      (await repository.read(actor, "knowledge/approved-group-action.md"))
        .content
    ).toBe("Approved group action");
    expect(
      await repository.history(actor, "knowledge/approved-group-action.md")
    ).toHaveLength(1);
    expect(await send(guest, "Zoen aprovar", operationId)).toEqual(consent);
    const repeat = await send(guest, "Zoen aprovar");
    await waitForMatrixState(repeat.event_id, "completed");
    expect(
      await repository.history(actor, "knowledge/approved-group-action.md")
    ).toHaveLength(1);

    const revoked = await pending();
    await pending();
    const ambiguous = await send(guest, "Zoen aprovar");
    await waitForMatrixState(ambiguous.event_id, "completed");
    expect(
      await repository.history(actor, "knowledge/approved-group-action.md")
    ).toHaveLength(1);
    expect(
      (await server.settled(revoked.sessionId)).filter(
        (event) => event.type === "action.result"
      )
    ).toHaveLength(0);
    const identity = (
      await query<{ matrixId: string }>(
        sql`SELECT matrix_id AS "matrixId" FROM matrix_identities WHERE user_id = ${guest.userId}`
      )
    )[0];
    if (!identity) throw new Error("Missing member identity");
    await removeWorkspaceMember(actor, guest.userId);
    await expect(
      sendMatrixMessage(guest, {
        id: room.id,
        operationId: randomUUID(),
        text: "Zoen aprovar",
      })
    ).rejects.toThrow("WorkspaceAccessDenied");
    // Even a still-joined transport identity cannot bypass live workspace revocation.
    const late = z
      .object({ event_id: z.string() })
      .parse(
        await matrixRequest(
          "PUT",
          `rooms/${encodeURIComponent(room.roomId)}/send/m.room.message/${randomUUID()}`,
          { msgtype: "m.text", body: "Zoen aprovar" },
          identity.matrixId
        )
      );
    await replayMatrixEvent(room.roomId, late.event_id);
    expect(
      await query(
        sql`SELECT event_id FROM matrix_deliveries WHERE event_id = ${late.event_id}`
      )
    ).toHaveLength(0);
    expect(
      (await server.settled(revoked.sessionId)).filter(
        (event) => event.type === "action.result"
      )
    ).toHaveLength(0);
    expect(
      await repository.history(actor, "knowledge/approved-group-action.md")
    ).toHaveLength(1);
  } catch (error) {
    const sessions = await query<{ sessionId: string }>(
      sql`SELECT DISTINCT d.session_id AS "sessionId" FROM matrix_deliveries d JOIN workspace_group_bindings b ON b.id=d.binding_id WHERE b.workspace_id=${actor.workspaceId} AND d.session_id IS NOT NULL`
    );
    const traces = await Promise.all(
      sessions.map(async (row) => ({
        sessionId: row.sessionId,
        events: await server.request(`/probe/events/${row.sessionId}`),
      }))
    );
    throw new Error(JSON.stringify({ runtime: server.output(), traces }), {
      cause: error,
    });
  } finally {
    await closeMatrixRoom(actor, room.id);
    await reconcileMatrixRooms();
    await server.stop();
  }
}, 120_000);
