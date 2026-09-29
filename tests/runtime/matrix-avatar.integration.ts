import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { z } from "zod";
import { roomSchema } from "@zoen/companion-ui/rooms";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { workspaceFixture } from "./workspace-fixture";
import { matrixReceiver } from "./matrix-fixture";
import { setMatrixRoomAvatar } from "../../server/matrix/avatar";
import {
  createMatrixRoom,
  joinMatrixRoom,
  listMatrixRooms,
  requireMatrixRoom,
} from "../../server/matrix/rooms";
import { readMatrixRoomSync } from "../../server/matrix/sync/room";
import { readInboxSyncHead } from "@db/services/inbox";
import { WorkspaceAccessDenied } from "../../server/workspaces/access";
import * as matrix from "../../server/matrix/client";
import * as media from "../../server/matrix/media/upload";

let receiver: Awaited<ReturnType<typeof matrixReceiver>>;
beforeAll(async () => {
  receiver = await matrixReceiver();
});
afterAll(async () => {
  await receiver.close();
});

test(
  "group photos are normalized, private, revision checked and recover a lost native acknowledgement",
  { timeout: 60000 },
  async () => {
    await using fixture = await workspaceFixture();
    const room = await createMatrixRoom(fixture.actor, {
      operationId: randomUUID(),
      name: "Synthetic group photo",
    });
    await joinMatrixRoom(fixture.actor, room.id);
    await joinMatrixRoom(fixture.guest, room.id);
    const cursor = await readMatrixRoomSync(fixture.guest, { id: room.id });
    const original = await sharp({
      create: { width: 640, height: 480, channels: 3, background: "#78ad99" },
    })
      .withExif({ IFD0: { Copyright: "Synthetic private metadata" } })
      .jpeg()
      .toBuffer();
    const input = {
      id: room.id,
      operationId: randomUUID(),
      expectedRevision: null,
      file: {
        type: "file" as const,
        filename: "private-original.jpg",
        mediaType: "image/jpeg",
        url: `data:image/jpeg;base64,${original.toString("base64")}`,
      },
    };
    const saved = await setMatrixRoomAvatar(fixture.actor, input);
    expect(saved.status).toBe("saved");
    expect(saved.room.avatarRevision).toBe(input.operationId);
    const uri = z.string().parse(saved.room.avatarUri);
    const bytes = Buffer.from(uri.slice(uri.indexOf(",") + 1), "base64");
    expect(bytes.length).toBeLessThanOrEqual(24576);
    expect(await sharp(bytes).metadata()).toMatchObject({
      format: "webp",
      width: 192,
      height: 192,
    });
    expect((await sharp(bytes).metadata()).exif).toBeUndefined();
    const nativePath = `rooms/${encodeURIComponent(room.roomId)}/state/m.room.avatar`;
    const nativeAvatar = await matrix.matrixRequest("GET", nativePath);
    expect(
      z.object({ url: z.string().startsWith("mxc://") }).parse(nativeAvatar).url
    ).toBeTruthy();
    expect(nativeAvatar).toMatchObject({
      info: { w: 192, h: 192, mimetype: "image/webp", size: bytes.length },
      "org.zoen.avatar.operation": input.operationId,
    });
    const upload = vi.spyOn(media, "uploadMatrixMedia");
    try {
      expect(await setMatrixRoomAvatar(fixture.actor, input)).toEqual(saved);
      expect(upload).not.toHaveBeenCalled();
      const stale = await setMatrixRoomAvatar(fixture.actor, {
        ...input,
        operationId: randomUUID(),
      });
      expect(stale).toEqual({ ...saved, status: "conflict" });
      expect(
        (await listMatrixRooms(fixture.guest)).rooms.find(
          (item) => item.id === room.id
        )?.avatarUri
      ).toBe(saved.room.avatarUri);
      const head = await readInboxSyncHead(fixture.guest, {
        filter: "groups",
        query: "",
        archived: false,
      });
      expect(
        roomSchema.parse(head.rows.find((item) => item.id === room.id)?.payload)
          .avatarUri
      ).toBe(saved.room.avatarUri);
      const change = await readMatrixRoomSync(fixture.guest, {
        id: room.id,
        cursor: cursor.cursor ?? undefined,
      });
      expect(change).toMatchObject({
        status: "ready",
        timelineChanged: true,
        changes: null,
      });
      for (const denied of [
        fixture.guest,
        fixture.personal,
        { ...fixture.actor, authSessionId: undefined },
        { ...fixture.actor, groupBindingId: randomUUID() },
      ])
        await expect(setMatrixRoomAvatar(denied, input)).rejects.toThrow(
          WorkspaceAccessDenied
        );

      const request = matrix.matrixRequest;
      const next = {
        ...input,
        operationId: randomUUID(),
        expectedRevision: input.operationId,
      };
      const native = vi
        .spyOn(matrix, "matrixRequest")
        .mockImplementation(async (...args) => {
          const result = await request(...args);
          if (args[0] === "PUT" && args[1] === nativePath)
            throw new matrix.MatrixError({ reason: "unavailable" });
          return result;
        });
      try {
        await expect(setMatrixRoomAvatar(fixture.actor, next)).rejects.toThrow(
          matrix.MatrixError
        );
      } finally {
        native.mockRestore();
      }
      expect(
        (await requireMatrixRoom(fixture.actor, room.id)).avatarRevision
      ).toBe(input.operationId);
      const uploaded = upload.mock.calls.length;
      expect(
        (await setMatrixRoomAvatar(fixture.actor, next)).room.avatarRevision
      ).toBe(next.operationId);
      expect(upload.mock.calls.length).toBe(uploaded);
      const outcomes = await Promise.all(
        [1, 2].map(() =>
          setMatrixRoomAvatar(fixture.actor, {
            ...input,
            file: null,
            operationId: randomUUID(),
            expectedRevision: next.operationId,
          })
        )
      );
      expect(outcomes.map((item) => item.status).toSorted()).toEqual([
        "conflict",
        "saved",
      ]);
      expect(
        (await requireMatrixRoom(fixture.guest, room.id)).avatarUri
      ).toBeNull();
      expect(await matrix.matrixRequest("GET", nativePath)).not.toHaveProperty(
        "url"
      );
      const invalid = {
        ...next,
        file: {
          ...input.file,
          mediaType: "image/png",
          url: `data:image/png;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>').toString("base64")}`,
        },
      };
      await expect(setMatrixRoomAvatar(fixture.actor, invalid)).rejects.toThrow(
        "Unsupported group image"
      );
    } finally {
      upload.mockRestore();
    }
  }
);
