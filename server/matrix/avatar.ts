import sharp from "sharp";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { query, transaction } from "@db/queries";
import { roomAvatarWriteSchema } from "@zoen/companion-ui/rooms";
import type { WorkspaceActorSchema } from "../workspaces/access";
import { WorkspaceAccessDenied } from "../workspaces/access";
import { requireMatrixRoom } from "./rooms";
import { uploadMatrixMedia } from "./media/upload";
import { MatrixError, matrixConfiguration, matrixRequest } from "./client";

const avatarContent = z.object({
  url: z.string().startsWith("mxc://").max(2048).optional(),
  "org.zoen.avatar.operation": z.uuid().optional(),
  "org.zoen.avatar.digest": z.string().max(64).optional(),
});

/** Only normalized thumbnails enter the authorized room projection, never original photos. */
async function normalizeGroupAvatar(
  file: z.infer<typeof roomAvatarWriteSchema>["file"]
) {
  if (!file) return null;
  const parsed = roomAvatarWriteSchema.shape.file.unwrap().parse(file);
  const input = sharp(
    Buffer.from(parsed.url.slice(parsed.url.indexOf(",") + 1), "base64"),
    {
      limitInputPixels: 24_000_000,
      failOn: "warning",
    }
  );
  const metadata = await input.metadata();
  if (!["jpeg", "png", "webp", "heif"].includes(metadata.format))
    throw new Error("Unsupported group image");
  const bytes = await input
    .autoOrient()
    .resize(192, 192, { fit: "cover" })
    .webp({ quality: 65, effort: 2 })
    .timeout({ seconds: 5 })
    .toBuffer();
  if (bytes.length > 24_576)
    throw new Error("Group image exceeds thumbnail limit");
  return {
    type: "file" as const,
    mediaType: "image/webp",
    filename: "group.webp",
    url: `data:image/webp;base64,${bytes.toString("base64")}`,
  };
}

/** App writers serialize with membership/name changes; the native operation marker repairs lost acknowledgements. */
export async function setMatrixRoomAvatar(
  actor: z.infer<typeof WorkspaceActorSchema>,
  raw: z.infer<typeof roomAvatarWriteSchema>
) {
  const input = roomAvatarWriteSchema.parse(raw);
  if (!actor.authSessionId || actor.groupBindingId || actor.protocolTaskId)
    throw new WorkspaceAccessDenied();
  await requireMatrixRoom(actor, input.id, true);
  const image = await normalizeGroupAvatar(input.file);
  const digest = createHash("sha256")
    .update(image?.url ?? "")
    .digest("hex");
  return transaction(async () => {
    await query(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.id}, 5))`
    );
    const room = await requireMatrixRoom(actor, input.id, true);
    if (room.avatarRevision === input.operationId)
      return { status: "saved" as const, room };
    if ((room.avatarRevision ?? null) !== input.expectedRevision)
      return { status: "conflict" as const, room };
    const path = `rooms/${encodeURIComponent(room.roomId)}/state/m.room.avatar`;
    const current = await readNativeAvatar(path);
    if (current["org.zoen.avatar.operation"] !== input.operationId) {
      const media = image
        ? await uploadMatrixMedia(image, (await matrixConfiguration()).botId)
        : undefined;
      await requireMatrixRoom(actor, input.id, true);
      await matrixRequest("PUT", path, {
        ...(media && {
          url: media.url,
          info: { ...media.info, w: 192, h: 192 },
        }),
        "org.zoen.avatar.operation": input.operationId,
        "org.zoen.avatar.digest": digest,
      });
    }
    const saved = await readNativeAvatar(path);
    if (
      saved["org.zoen.avatar.operation"] !== input.operationId ||
      saved["org.zoen.avatar.digest"] !== digest ||
      !!saved.url !== !!image
    )
      throw new MatrixError({ reason: "conflict" });
    await requireMatrixRoom(actor, input.id, true);
    await query(sql`UPDATE workspace_group_bindings SET avatar_uri = ${image?.url ?? null}, avatar_revision = ${input.operationId}
      WHERE id = ${input.id} AND workspace_id = ${actor.workspaceId}`);
    return {
      status: "saved" as const,
      room: await requireMatrixRoom(actor, input.id, true),
    };
  });
}

async function readNativeAvatar(path: string) {
  try {
    return avatarContent.parse(
      await matrixRequest("GET", path, undefined, undefined, {
        maxResponseBytes: 8192,
      })
    );
  } catch (error) {
    if (error instanceof MatrixError && error.reason === "not-found")
      return avatarContent.parse({});
    throw error;
  }
}
