import { randomUUID } from "node:crypto";
import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import { discoverContributionChannels } from "../../server/matrix/contributions";
import { createMatrixRoom, joinMatrixRoom } from "../../server/matrix/rooms";
import { workspaceFixture } from "./workspace-fixture";

export async function communityFixture() {
  const resources = new AsyncDisposableStack();
  try {
    const first = resources.use(await workspaceFixture());
    const second = resources.use(await workspaceFixture());
    await query(
      sql`UPDATE workspaces SET display_name = 'Cedarbay' WHERE id = ${first.actor.workspaceId}`
    );
    await query(
      sql`UPDATE workspaces SET display_name = 'Harbor' WHERE id = ${second.actor.workspaceId}`
    );
    await query(sql`INSERT INTO organization_memberships (organization_id, user_id, role)
      SELECT organization_id, ${first.actor.userId}, 'member' FROM workspaces WHERE id = ${second.actor.workspaceId}`);
    await query(sql`INSERT INTO workspace_memberships (workspace_id, user_id, role)
      VALUES (${second.actor.workspaceId}, ${first.actor.userId}, 'member')`);
    const secondActor = {
      ...first.actor,
      workspaceId: second.actor.workspaceId,
    };
    const firstRoom = await createMatrixRoom(first.actor, {
      operationId: randomUUID(),
      name: "Research",
    });
    const secondRoom = await createMatrixRoom(second.actor, {
      operationId: randomUUID(),
      name: "Planning",
    });
    await joinMatrixRoom(first.actor, firstRoom.id);
    await joinMatrixRoom(second.actor, secondRoom.id);
    await joinMatrixRoom(secondActor, secondRoom.id);
    const { destinations } = await discoverContributionChannels(first.personal);
    const destination = destinations.find(
      (item) => item.channelId === firstRoom.id
    );
    const otherDestination = destinations.find(
      (item) => item.channelId === secondRoom.id
    );
    if (!destination || !otherDestination)
      throw new Error(
        "Both current community memberships must be discoverable"
      );
    return {
      [Symbol.asyncDispose]: () => resources.disposeAsync(),
      first,
      second,
      firstRoom,
      secondRoom,
      destination,
      otherDestination,
      input: {
        operationId: randomUUID(),
        destination,
        purpose: `Private reasoning ${randomUUID()}; publish only the approved excerpt.`,
        text: `Approved synthetic excerpt ${randomUUID()}\nFull final line.`,
      },
    };
  } catch (error) {
    await resources.disposeAsync();
    throw error;
  }
}
