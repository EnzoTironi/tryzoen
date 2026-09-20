import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import { ChannelAccountError } from "../accounts/errors";
import { z } from "zod";

import { accessScopeForUser } from "../../shared/identity/access-scope";
import { ChannelAccounts, IdentitySchema } from "../accounts";
import { MessagePayloadSchema } from "../messaging/model";
import { ArtifactError, type ArtifactSourceSchema } from "./model";

const sourceRow = z.object({
  eventId: z.string(),
  sourceMessageId: z.string(),
  payload: MessagePayloadSchema,
});

export const artifactAccess = async () => {
  const accounts = ChannelAccounts;
  const requireArtifactActor = async function (identityId: string) {
    const rows = await query(sql`SELECT id, user_id AS "userId", channel,
    installation_id AS "installationId", sender_id AS "senderId"
    FROM channel_identity WHERE id = ${identityId} AND revoked_at IS NULL FOR SHARE`);
    if (!rows[0]) throw new ArtifactError({ reason: "not_found" });
    const candidate = await IdentitySchema.parseAsync(rows[0]);
    const identity = await Promise.try(async () =>
      accounts.getActiveIdentity(candidate)
    ).catch((error: unknown) => {
      if (error instanceof ChannelAccountError)
        return (() => {
          throw new ArtifactError({ reason: "not_found" });
        })();
      throw error;
    });
    const scope = accessScopeForUser(`better-auth:${identity.userId}`);
    const membership = await query(sql`SELECT 1 FROM workspace_memberships
    WHERE workspace_id = ${scope.workspaceId} AND user_id = ${scope.userId} FOR SHARE`);
    if (identity.id !== identityId || membership.length !== 1)
      throw new ArtifactError({ reason: "not_found" });
    return scope;
  };

  const readArtifactSource = async function (
    input: z.output<typeof ArtifactSourceSchema>
  ) {
    const rows =
      await query(sql`SELECT event_id AS "eventId", source_message_id AS "sourceMessageId", payload
    FROM channel_inbox WHERE id = ${input.sourceInboxId} AND identity_id = ${input.identityId} FOR SHARE`);
    if (!rows[0]) throw new ArtifactError({ reason: "source_invalid" });
    const source = await sourceRow.parseAsync(rows[0]);
    const matches =
      source.payload.attachments?.filter(
        (entry) => entry.id === input.mediaId
      ) ?? [];
    const [attachment] = matches;
    if (matches.length !== 1 || !attachment)
      throw new ArtifactError({ reason: "source_invalid" });
    return {
      sourceEventId: source.eventId,
      sourceMessageId: source.sourceMessageId,
      sourceMediaId: attachment.id,
      filename: attachment.name ?? "attachment",
      mediaType: attachment.mediaType,
    };
  };

  return { requireArtifactActor, readArtifactSource };
};
