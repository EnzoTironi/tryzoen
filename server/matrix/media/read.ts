import type { z } from "zod";
import type { roomMediaReadSchema } from "@zoen/companion-ui/rooms";
import {
  attachmentLimits,
  inlineAttachmentSchema,
} from "@zoen/companion-ui/messages";
import { matrixConfiguration } from "../client";
import { downloadMediaBytes } from "../../channels/media/download";
import { joinMatrixRoom } from "../rooms";
import { readRoomMessage } from "../messages";
import {
  requireWorkspaceAccess,
  WorkspaceAccessDenied,
  type WorkspaceActorSchema,
} from "../../workspaces/access";

/** Resolve media through its room event; never accept a client-provided download URL. */
export async function readMatrixMedia(
  actor: z.infer<typeof WorkspaceActorSchema>,
  input: z.infer<typeof roomMediaReadSchema>
) {
  const room = await joinMatrixRoom(actor, input.id);
  const event = await readRoomMessage(room, input.messageId);
  const { url, info, filename, body } = event.content;
  if (
    !url ||
    !/^m\.(image|video|audio|file)$/u.test(event.content.msgtype ?? "")
  )
    throw new WorkspaceAccessDenied();
  const match = /^mxc:\/\/([^/]+)\/([A-Za-z0-9_-]+)$/u.exec(url);
  if (!match?.[1] || !match[2]) throw new WorkspaceAccessDenied();
  const config = await matrixConfiguration();
  const endpoint = new URL(
    `/_matrix/client/v1/media/download/${encodeURIComponent(match[1])}/${encodeURIComponent(match[2])}`,
    config.url
  );
  endpoint.searchParams.set("user_id", room.matrixId);
  const bytes = await downloadMediaBytes(
    endpoint.href,
    attachmentLimits.bytes,
    {
      headers: { authorization: `Bearer ${config.token.reveal()}` },
    }
  );
  await requireWorkspaceAccess(actor);
  await joinMatrixRoom(actor, input.id);
  return inlineAttachmentSchema.parse({
    type: "file",
    filename: (filename ?? body ?? "attachment").slice(0, 255),
    mediaType: info?.mimetype ?? "application/octet-stream",
    url: `data:${info?.mimetype ?? "application/octet-stream"};base64,${bytes.toString("base64")}`,
  });
}
