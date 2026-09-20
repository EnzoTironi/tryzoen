import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import type { ChannelReceiveContext } from "eve/channels";
import { WorkspaceAccessDenied } from "../workspaces/access";

export const pendingProtocolCancellations = async function () {
  return await query<{
    session_id: string;
  }>(sql`SELECT session_id FROM agent_protocol_cancellations
    ORDER BY requested_at LIMIT 25`);
};

/** Called only by the authenticated native scheduler; the persisted outbox is the authority. */
export const deliverProtocolCancellation = async function (
  sessionId: string,
  channel: Pick<ChannelReceiveContext, "resolveSession">
) {
  const queued = await query(
    sql`SELECT 1 FROM agent_protocol_cancellations WHERE session_id = ${sessionId}`
  );
  if (!queued.length) throw new WorkspaceAccessDenied();
  const session = await channel.resolveSession(`session:${sessionId}`);
  if (!session || session.id !== sessionId)
    throw new Error("Native task cancellation remains pending");
  await session.cancel({ tasks: true });
  await query(
    sql`DELETE FROM agent_protocol_cancellations WHERE session_id = ${sessionId}`
  );
  return session;
};
