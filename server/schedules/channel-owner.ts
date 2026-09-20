import { query } from "@db/queries";
import { sql } from "drizzle-orm";

import type { AccessScope } from "../../shared/identity/access-scope";
import { ChannelTransport } from "../channels/transport";

export class ScheduleOwnerInactive extends Error {
  readonly _tag = "ScheduleOwnerInactive";

  constructor() {
    super("ScheduleOwnerInactive");
    this.name = "ScheduleOwnerInactive";
  }
}

const requireScheduleMembership = async function (scope: AccessScope) {
  const rows = await query(sql`SELECT user_id FROM workspace_memberships
      WHERE workspace_id = ${scope.workspaceId} AND user_id = ${scope.userId}
      FOR KEY SHARE`);
  if (!rows[0]) throw new ScheduleOwnerInactive();
  return undefined;
};

export const requireScheduledChannelOwner = async function (job: {
  readonly conversationChannel: "telegram" | "kapso";
  readonly conversationId: string;
  readonly createdByUserId: string;
  readonly workspaceId: string;
}) {
  const transport = ChannelTransport;
  const identity = await transport.activeIdentity(
    job.conversationId,
    job.conversationChannel
  );
  if (`better-auth:${identity.userId}` !== job.createdByUserId)
    throw new ScheduleOwnerInactive();
  await requireScheduleMembership({
    userId: job.createdByUserId,
    workspaceId: job.workspaceId,
  });
  return identity;
};
