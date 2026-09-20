import { query, transaction as withDatabaseTransaction } from "@db/queries";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { z } from "zod";
import {
  ClaimChannelInputResponseSchema,
  type ClaimChannelInputResponse,
  decodeInput,
  IdentityInactive,
  InvalidMessage,
  MarkChannelInputResponseSchema,
} from "./model";

type ResponseRow = Pick<
  ClaimChannelInputResponse,
  "identityId" | "sourceMessageId" | "revision" | "decision" | "turnId"
> & {
  id: string;
  status: "attempted" | "accepted" | "uncertain";
};

export const InputResponses = {
  claim: async function (input: ClaimChannelInputResponse) {
    return await withDatabaseTransaction(async () => {
      const value = await decodeInput(ClaimChannelInputResponseSchema)(input);
      const identities = await query<{
        active: boolean;
      }>(sql`SELECT revoked_at IS NULL AS active
      FROM channel_identity WHERE id = ${value.identityId} FOR UPDATE`);
      if (!identities[0]?.active)
        throw new IdentityInactive({ identityId: value.identityId });
      const sources = await query<{
        id: string;
      }>(sql`SELECT id FROM channel_inbox
      WHERE identity_id = ${value.identityId} AND session_id = ${value.sessionId}
      AND source_message_id = ${value.sourceMessageId} AND status = 'accepted' LIMIT 2`);
      const source = sources[0];
      if (!source || sources.length !== 1) {
        throw new InvalidMessage({
          message:
            "Response requires one accepted source message in this session.",
        });
      }
      const inserted = await query<{
        id: string;
      }>(sql`INSERT INTO channel_input_response
      (id, identity_id, inbox_id, session_id, source_message_id, request_id, revision, decision, turn_id)
      VALUES (${randomUUID()}, ${value.identityId}, ${source.id}, ${value.sessionId},
        ${value.sourceMessageId}, ${value.requestId}, ${value.revision}, ${value.decision}, ${value.turnId})
      ON CONFLICT (session_id, request_id) DO NOTHING RETURNING id`);
      if (inserted[0])
        return {
          kind: "acquired" as const,
          id: inserted[0].id,
          status: "attempted" as const,
        };
      const rows =
        await query<ResponseRow>(sql`SELECT id, identity_id AS "identityId",
      source_message_id AS "sourceMessageId", revision, decision, turn_id AS "turnId", status
      FROM channel_input_response WHERE session_id = ${value.sessionId} AND request_id = ${value.requestId}`);
      const previous = rows[0];
      if (!previous)
        throw new InvalidMessage({
          message: "Response claim disappeared.",
        });
      const same =
        previous.identityId === value.identityId &&
        previous.sourceMessageId === value.sourceMessageId &&
        previous.revision === value.revision &&
        previous.decision === value.decision &&
        previous.turnId === value.turnId;
      return {
        kind: same ? ("duplicate" as const) : ("conflict" as const),
        id: previous.id,
        status: previous.status,
      };
    });
  },

  mark: async function (
    input: z.output<typeof MarkChannelInputResponseSchema>
  ) {
    const value = await decodeInput(MarkChannelInputResponseSchema)(input);
    const rows = await query<{ id: string }>(sql`UPDATE channel_input_response
      SET status = ${value.status}, completed_at = clock_timestamp()
      WHERE id = ${value.id} AND status = 'attempted' RETURNING id`);
    return rows.length === 1;
  },
};
