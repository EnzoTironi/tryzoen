import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { query } from "@db/queries";
import { workspaceFixture } from "./workspace-fixture";
import { matrixReceiver } from "./matrix-fixture";
import { syncConversationInbox } from "../../server/matrix/sync";
import { createMatrixRoom, sendMatrixMessage } from "../../server/matrix/rooms";
import { deleteMatrixMessage } from "../../server/matrix/message-actions";
import { matrixRequest } from "../../server/matrix/client";
import { ensureMatrixIdentity } from "../../server/matrix/identities";
import { WorkspaceAccessDenied } from "../../server/workspaces/access";

test(
  "two auth sessions safely replay independent cursors on one bridge device",
  { timeout: 60000 },
  async () => {
    const receiver = await matrixReceiver();
    try {
      await using fixture = await workspaceFixture();
      const secondSession = randomUUID();
      await query(
        sql`INSERT INTO public.session(id,token,"userId","expiresAt","updatedAt") SELECT ${secondSession},${randomUUID()},"userId",now()+interval '1 day',now() FROM public.session WHERE id=${fixture.actor.authSessionId}`
      );
      const secondActor = { ...fixture.actor, authSessionId: secondSession };
      const room = await createMatrixRoom(fixture.actor, {
        operationId: randomUUID(),
        name: "Synthetic foreground sync",
      });
      for (let index = 0; index < 31; index++) {
        const id = randomUUID();
        await query(
          sql`INSERT INTO agent_sessions(session_id,workspace_id,created_by_user_id) VALUES(${id},${fixture.actor.workspaceId},${fixture.actor.userId})`
        );
        await query(
          sql`INSERT INTO chats(session_id,workspace_id,title,updated_at) VALUES(${id},${fixture.actor.workspaceId},${`Head agent ${index}`},'2020-01-01')`
        );
      }
      const start = await syncConversationInbox(fixture.actor, {});
      expect(start.changedRoomIds).toEqual([]);
      const secondStart = await syncConversationInbox(secondActor, {});
      expect(start.status).toBe("ready");
      expect(start.reset).toBe(true);
      const message = await sendMatrixMessage(fixture.actor, {
        id: room.id,
        operationId: randomUUID(),
        text: "Private body must not enter sync response",
      });
      const next = await syncConversationInbox(fixture.actor, {
        cursor: z.string().parse(start.cursor),
      });
      expect(next.changedRoomIds).toContain(room.id);
      expect(JSON.stringify(next)).not.toContain("Private body");
      const secondReady = await syncConversationInbox(secondActor, {
        cursor: z.string().parse(secondStart.cursor),
      });
      const replay = await syncConversationInbox(fixture.actor, {
        cursor: z.string().parse(start.cursor),
      });
      expect(replay.changedRoomIds).toEqual(next.changedRoomIds);
      await expect(
        syncConversationInbox(secondActor, {
          cursor: z.string().parse(next.cursor),
        })
      ).rejects.toThrow(WorkspaceAccessDenied);
      await expect(
        syncConversationInbox(fixture.actor, {
          cursor: `${z.string().parse(next.cursor)}x`,
        })
      ).rejects.toThrow(WorkspaceAccessDenied);
      const idle = await syncConversationInbox(fixture.actor, {
        cursor: z.string().parse(next.cursor),
      });
      await deleteMatrixMessage(fixture.actor, {
        id: room.id,
        messageId: message.event_id,
        operationId: randomUUID(),
      });
      const removed = await syncConversationInbox(fixture.actor, {
        cursor: z.string().parse(idle.cursor),
      });
      expect(removed.changedRoomIds).toContain(room.id);
      const second = await syncConversationInbox(secondActor, {
        cursor: z.string().parse(secondReady.cursor),
      });
      const secondCaughtUp = await syncConversationInbox(secondActor, {
        cursor: z.string().parse(second.cursor),
      });
      expect([
        ...second.changedRoomIds,
        ...secondCaughtUp.changedRoomIds,
      ]).toContain(room.id);
      const original = await sendMatrixMessage(fixture.actor, {
        id: room.id,
        operationId: randomUUID(),
        text: "Original",
      });
      const beforeEdit = await syncConversationInbox(fixture.actor, {
        cursor: z.string().parse(removed.cursor),
      });
      const viewer = await ensureMatrixIdentity(fixture.actor);
      await matrixRequest(
        "PUT",
        `rooms/${encodeURIComponent(room.roomId)}/send/m.room.message/${randomUUID()}`,
        {
          msgtype: "m.text",
          body: "* Edited",
          "m.new_content": { msgtype: "m.text", body: "Edited" },
          "m.relates_to": {
            rel_type: "m.replace",
            event_id: original.event_id,
          },
        },
        viewer
      );
      const edited = await syncConversationInbox(fixture.actor, {
        cursor: z.string().parse(beforeEdit.cursor),
      });
      expect(edited.changedRoomIds).toContain(room.id);
      for (let index = 0; index < 3; index++)
        await sendMatrixMessage(fixture.actor, {
          id: room.id,
          operationId: randomUUID(),
          text: `Gap ${index}`,
        });
      const gap = await syncConversationInbox(fixture.actor, {
        cursor: z.string().parse(edited.cursor),
      });
      expect(gap.gapRoomIds).toContain(room.id);
      await query(sql`DELETE FROM public.session WHERE id=${secondSession}`);
      await expect(
        syncConversationInbox(secondActor, {
          cursor: z.string().parse(second.cursor),
        })
      ).rejects.toThrow(WorkspaceAccessDenied);
    } finally {
      await receiver.close();
    }
  }
);
