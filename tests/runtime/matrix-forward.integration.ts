import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import { matrixReceiver } from "./matrix-fixture";
import { workspaceFixture } from "./workspace-fixture";
import { saveDirectoryProfile } from "../../server/accounts/directory";
import { openDirectRoom } from "../../server/matrix/direct";
import {
  createMatrixRoom,
  joinMatrixRoom,
  readMatrixMessages,
  sendMatrixMessage,
} from "../../server/matrix/rooms";
import {
  forwardMatrixMessage,
  listForwardDestinations,
} from "../../server/matrix/forward";
import { editMatrixMessage } from "../../server/matrix/edits";
import { deleteMatrixMessage } from "../../server/matrix/message-actions";
import { readMatrixMedia } from "../../server/matrix/media/read";
import { matrixConfiguration } from "../../server/matrix/client";
import { WorkspaceAccessDenied } from "../../server/workspaces/access";

let receiver: Awaited<ReturnType<typeof matrixReceiver>> | undefined;
beforeAll(async () => {
  receiver = await matrixReceiver();
});
afterAll(async () => {
  await receiver?.close();
});

test(
  "real forwarding copies reviewed text and media, isolates the source and preserves native retries",
  { timeout: 120000 },
  async () => {
    await using fixture = await workspaceFixture();
    await using outsider = await workspaceFixture();
    const guestName = `forward_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
    await saveDirectoryProfile(fixture.guest, {
      username: guestName,
      discoverable: false,
    });
    const direct = await openDirectRoom(fixture.actor, {
      username: guestName,
      operationId: randomUUID(),
    });
    const group = await createMatrixRoom(fixture.actor, {
      operationId: randomUUID(),
      name: "Synthetic forwarding destination",
    });
    // Group history starts at membership, including for its creator.
    await joinMatrixRoom(fixture.actor, group.id);
    await joinMatrixRoom(fixture.guest, group.id);
    const original = await sendMatrixMessage(fixture.actor, {
      id: direct.id,
      operationId: randomUUID(),
      text: "Zoen, this copied text must not start a task.",
    });
    const input = {
      id: direct.id,
      messageId: original.event_id,
      expectedRevision: original.event_id,
      destinationId: group.id,
      operationId: randomUUID(),
    };
    const result = await forwardMatrixMessage(fixture.guest, input);
    expect(result.status).toBe("sent");
    if (result.status !== "sent") throw new Error("Missing copy");
    expect(await forwardMatrixMessage(fixture.guest, input)).toEqual(result);
    const messages = (await readMatrixMessages(fixture.actor, group.id))
      .messages;
    expect(
      messages.filter((message) => message.id === result.messageId)
    ).toHaveLength(1);
    expect(messages.at(-1)).toMatchObject({
      text: "Zoen, this copied text must not start a task.",
      forwarded: true,
      mine: false,
      reply: null,
      rootId: null,
    });
    await vi.waitFor(
      () => {
        expect(
          receiver?.receipts.some((receipt) =>
            receipt.body.includes(result.messageId)
          )
        ).toBe(true);
      },
      { timeout: 15000, interval: 100 }
    );
    expect(
      await query(
        sql`SELECT event_id FROM matrix_deliveries WHERE event_id=${result.messageId}`
      )
    ).toEqual([]);

    const edit = await editMatrixMessage(fixture.actor, {
      id: direct.id,
      messageId: original.event_id,
      expectedRevision: original.event_id,
      operationId: randomUUID(),
      text: "The reviewed revision changed.",
    });
    expect(edit.status).toBe("saved");
    const changed = await forwardMatrixMessage(fixture.guest, {
      ...input,
      operationId: randomUUID(),
    });
    expect(changed).toMatchObject({
      status: "changed",
      message: { text: "The reviewed revision changed." },
    });
    expect(
      (await readMatrixMessages(fixture.actor, group.id)).messages
    ).toHaveLength(1);

    const file = {
      type: "file" as const,
      filename: "synthetic-forward.txt",
      mediaType: "text/plain",
      url: "data:text/plain;base64,U3ludGhldGljIGZpbGU=",
    };
    const uploaded = await sendMatrixMessage(fixture.actor, {
      id: direct.id,
      operationId: randomUUID(),
      text: "",
      files: [file],
    });
    const attachment = await forwardMatrixMessage(fixture.guest, {
      ...input,
      messageId: uploaded.event_id,
      expectedRevision: uploaded.event_id,
      operationId: randomUUID(),
    });
    if (attachment.status !== "sent") throw new Error("Missing file copy");
    expect(
      await readMatrixMedia(fixture.actor, {
        id: group.id,
        messageId: attachment.messageId,
      })
    ).toEqual(file);
    await deleteMatrixMessage(fixture.actor, {
      id: direct.id,
      messageId: uploaded.event_id,
      operationId: randomUUID(),
    });
    expect(
      await readMatrixMedia(fixture.actor, {
        id: group.id,
        messageId: attachment.messageId,
      })
    ).toEqual(file);
    await expect(
      forwardMatrixMessage(fixture.guest, {
        ...input,
        messageId: uploaded.event_id,
        expectedRevision: uploaded.event_id,
        operationId: randomUUID(),
      })
    ).rejects.toThrow(WorkspaceAccessDenied);

    // Even an administrator of the workspace does not inherit the private pair.
    await query(sql`INSERT INTO organization_memberships (organization_id,user_id,role)
    SELECT organization_id,${outsider.actor.userId},'admin' FROM workspaces WHERE id=${fixture.actor.workspaceId}`);
    await query(
      sql`INSERT INTO workspace_memberships(workspace_id,user_id,role) VALUES(${fixture.actor.workspaceId},${outsider.actor.userId},'admin')`
    );
    const admin = { ...outsider.actor, workspaceId: fixture.actor.workspaceId };
    await expect(forwardMatrixMessage(admin, input)).rejects.toThrow(
      WorkspaceAccessDenied
    );
    await expect(
      listForwardDestinations(admin, { id: direct.id, query: "" })
    ).rejects.toThrow(WorkspaceAccessDenied);

    await query(
      sql`UPDATE workspace_group_bindings SET revoked_at=now() WHERE id=${group.id}`
    );
    await expect(
      forwardMatrixMessage(fixture.guest, {
        ...input,
        expectedRevision: edit.message.editId ?? original.event_id,
      })
    ).rejects.toThrow(WorkspaceAccessDenied);
  }
);

test(
  "destination pagination includes every authorized room and treats search wildcards literally",
  { timeout: 60000 },
  async () => {
    await using fixture = await workspaceFixture();
    const source = await createMatrixRoom(fixture.actor, {
      operationId: randomUUID(),
      name: "Synthetic paging source",
    });
    const config = await matrixConfiguration();
    const ids = Array.from({ length: 25 }, () => randomUUID())
      .toSorted()
      .toReversed();
    for (const [index, id] of ids.entries())
      await query(sql`INSERT INTO workspace_group_bindings(id,workspace_id,channel,installation_id,conversation_id,label,created_by)
      VALUES(${id},${fixture.actor.workspaceId},'matrix',${config.serverName},${`!pagination-${id}:test`},${index === 0 ? "Pagination 100% checked" : `Pagination ${index}`},${fixture.actor.userId})`);
    const page = await listForwardDestinations(fixture.actor, {
      id: source.id,
      query: "Pagination",
    });
    expect(page.items.map((item) => item.id)).toEqual(ids.slice(0, 20));
    expect(page.nextCursor).toBe(ids[19]);
    const next = await listForwardDestinations(fixture.actor, {
      id: source.id,
      query: "Pagination",
      before: page.nextCursor ?? undefined,
    });
    expect(next.items.map((item) => item.id)).toEqual(ids.slice(20));
    expect(next.nextCursor).toBeNull();
    expect(
      (
        await listForwardDestinations(fixture.actor, {
          id: source.id,
          query: "%",
        })
      ).items.map((item) => item.id)
    ).toEqual([ids[0]]);
    await expect(
      listForwardDestinations(fixture.personal, { id: source.id, query: "" })
    ).rejects.toThrow(WorkspaceAccessDenied);
  }
);
