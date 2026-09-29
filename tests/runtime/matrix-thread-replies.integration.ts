import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { workspaceFixture } from "./workspace-fixture";
import { matrixReceiver } from "./matrix-fixture";
import {
  createMatrixRoom,
  joinMatrixRoom,
  readMatrixMessages,
} from "../../server/matrix/rooms";
import { sendMatrixMessage } from "../../server/matrix/send";
import {
  readThreadSubscription,
  setThreadSubscription,
} from "../../server/matrix/thread-subscriptions";
import { WorkspaceAccessDenied } from "../../server/workspaces/access";
import * as matrix from "../../server/matrix/client";

let receiver: Awaited<ReturnType<typeof matrixReceiver>>;
beforeAll(async () => {
  receiver = await matrixReceiver();
});
afterAll(async () => {
  await receiver.close();
});

test(
  "replies follow natively without replaying over a later unfollow or failing an accepted message",
  { timeout: 60000 },
  async () => {
    await using fixture = await workspaceFixture();
    const room = await createMatrixRoom(fixture.actor, {
      operationId: randomUUID(),
      name: "Synthetic automatic thread",
    });
    await joinMatrixRoom(fixture.guest, room.id);
    const root = await sendMatrixMessage(fixture.actor, {
      id: room.id,
      operationId: randomUUID(),
      text: "Root",
    });
    const target = { id: room.id, rootId: root.event_id };
    const reply = { ...target, operationId: randomUUID(), text: "Reply" };
    const followed = { status: "ready", following: true, automatic: true };
    const first = await sendMatrixMessage(fixture.guest, reply);
    expect(first.subscription).toEqual(followed);
    expect(await readThreadSubscription(fixture.actor, target)).toMatchObject({
      following: false,
    });
    expect(await sendMatrixMessage(fixture.guest, reply)).toEqual(first);
    await setThreadSubscription(fixture.guest, { ...target, following: true });
    expect(
      (await sendMatrixMessage(fixture.guest, reply)).subscription
    ).toMatchObject({ following: true, automatic: false });
    await setThreadSubscription(fixture.guest, { ...target, following: false });
    expect(
      (await sendMatrixMessage(fixture.guest, reply)).subscription
    ).toMatchObject({ following: false });
    const next = await sendMatrixMessage(fixture.guest, {
      ...reply,
      operationId: randomUUID(),
      text: "New reply follows again",
    });
    expect(next.subscription).toEqual(followed);
    await expect(
      setThreadSubscription(
        fixture.actor,
        { ...target, following: true },
        first.event_id
      )
    ).rejects.toThrow(WorkspaceAccessDenied);

    await setThreadSubscription(fixture.guest, { ...target, following: false });
    const request = matrix.matrixRequest;
    const unavailable = vi
      .spyOn(matrix, "matrixRequest")
      .mockImplementation(async (...args) => {
        if (args[0] === "PUT" && args[1].endsWith("/subscription"))
          throw new matrix.MatrixError({ reason: "unavailable" });
        return request(...args);
      });
    const uncertain = {
      ...reply,
      operationId: randomUUID(),
      text: "Sent despite alert outage",
    };
    const accepted = await sendMatrixMessage(fixture.guest, uncertain);
    expect(accepted.subscription).toEqual({ status: "unconfirmed" });
    unavailable.mockRestore();
    expect(
      (
        await readMatrixMessages(
          fixture.guest,
          room.id,
          undefined,
          root.event_id
        )
      ).messages.filter((message) => message.id === accepted.event_id)
    ).toHaveLength(1);
    const confirmed = await sendMatrixMessage(fixture.guest, uncertain);
    expect(confirmed.event_id).toBe(accepted.event_id);
    expect(confirmed.subscription).toEqual(followed);

    await setThreadSubscription(fixture.guest, { ...target, following: false });
    const lost = vi
      .spyOn(matrix, "matrixRequest")
      .mockImplementation(async (...args) => {
        const result = await request(...args);
        if (args[0] === "PUT" && args[1].endsWith("/subscription"))
          throw new matrix.MatrixError({ reason: "unavailable" });
        return result;
      });
    const fileReply = {
      ...target,
      operationId: randomUUID(),
      text: "",
      files: [
        {
          type: "file" as const,
          filename: "synthetic.txt",
          mediaType: "text/plain",
          url: "data:text/plain;base64,c3ludGhldGlj",
        },
      ],
    };
    expect(
      (await sendMatrixMessage(fixture.guest, fileReply)).subscription
    ).toEqual({ status: "unconfirmed" });
    lost.mockRestore();
    expect(await readThreadSubscription(fixture.guest, target)).toEqual(
      followed
    );
    const unsupported = vi
      .spyOn(matrix, "matrixRequest")
      .mockImplementation(async (...args) => {
        if (args[1] === "versions") return { unstable_features: {} };
        return request(...args);
      });
    expect(
      (
        await sendMatrixMessage(fixture.guest, {
          ...reply,
          operationId: randomUUID(),
        })
      ).subscription
    ).toEqual({ status: "unsupported" });
    unsupported.mockRestore();
  }
);
