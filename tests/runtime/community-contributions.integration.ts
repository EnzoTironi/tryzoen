import { randomUUID } from "node:crypto";
import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { Pool } from "pg";
import { env } from "@shared/environment/env";
import { afterAll, beforeAll, expect, onTestFinished, test, vi } from "vitest";
import { CommunityDestinationSchema } from "@zoen/companion-ui/approval";
import {
  discoverContributionChannels,
  publishCommunityContribution,
  readContributionReceipt,
} from "../../server/matrix/contributions";
import { joinMatrixRoom, readMatrixMessages } from "../../server/matrix/rooms";
import { changeMatrixGroupMembership } from "../../server/matrix/membership";
import * as matrix from "../../server/matrix/client";
import { WorkspaceAccessDenied } from "../../server/workspaces/access";
import contributions from "../../agent/tools/community-contributions";
import { callNativeTool, nativeContext } from "../helpers/native-tools";
import { toolContextFor } from "../helpers/tool-context";
import { matrixReceiver } from "./matrix-fixture";
import { workspaceExecutionFor } from "./workspace-fixture";
import { communityFixture } from "./community-fixture";

let receiver: Awaited<ReturnType<typeof matrixReceiver>> | undefined;
beforeAll(async () => {
  receiver = await matrixReceiver();
});
afterAll(async () => {
  await receiver?.close();
});

test("one personal owner discovers two communities and publishes only the exact approved text in its selected channel", async () => {
  await using fixture = await communityFixture();
  const privateCanary = `Unapproved private context ${randomUUID()}`;
  await fixture.first.repository.write(fixture.first.personal, {
    path: "knowledge/private-context.md",
    content: privateCanary,
    expectedRevision: null,
    operationId: randomUUID(),
  });
  const execution = workspaceExecutionFor(fixture.first.personal);
  const discovered = z
    .object({ destinations: z.array(CommunityDestinationSchema) })
    .parse(await callNativeTool(execution, "community-channels", {}));
  expect(
    discovered.destinations.map((item) => item.communityName).sort()
  ).toEqual(["Cedarbay", "Harbor"]);
  await expect(
    fixture.first.repository.read(
      {
        ...fixture.first.guest,
        workspaceId: fixture.first.personal.workspaceId,
      },
      "knowledge/private-context.md"
    )
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  const operationId = randomUUID();
  const receipt = z
    .object({
      status: z.literal("published"),
      eventId: z.string(),
      operationId: z.uuid(),
    })
    .parse(
      await callNativeTool(execution, "community-contribute", {
        ...{ ...fixture.input, operationId },
      })
    );
  const messages = (
    await readMatrixMessages(fixture.first.actor, fixture.firstRoom.id)
  ).messages;
  expect(
    messages
      .filter((item) => item.id === receipt.eventId)
      .map((item) => item.text)
  ).toEqual([fixture.input.text]);
  expect(JSON.stringify(messages)).not.toContain(fixture.input.purpose);
  expect(JSON.stringify(messages)).not.toContain(privateCanary);
  expect(
    JSON.stringify(
      (await readMatrixMessages(fixture.second.actor, fixture.secondRoom.id))
        .messages
    )
  ).not.toContain(fixture.input.text);
  expect(
    await callNativeTool(execution, "community-contribution-result", {
      operationId,
    })
  ).toEqual(receipt);
  await expect(
    readContributionReceipt(fixture.first.guestPersonal, operationId)
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  await expect(
    readContributionReceipt(fixture.first.actor, operationId)
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  const rows = await query(
    sql`SELECT * FROM matrix_contribution_receipts WHERE workspace_id = ${fixture.first.personal.workspaceId}`
  );
  expect(JSON.stringify(rows)).not.toContain(fixture.input.text);
  expect(JSON.stringify(rows)).not.toContain(fixture.input.purpose);
  await query(
    sql`DELETE FROM workspaces WHERE id = ${fixture.first.personal.workspaceId}`
  );
  expect(
    await query(
      sql`SELECT 1 FROM matrix_contribution_receipts WHERE operation_id = ${operationId}`
    )
  ).toEqual([]);
});

test("lost native send response retains an immutable private receipt and explicit retry delivers exactly once", async () => {
  await using fixture = await communityFixture();
  const operationId = randomUUID();
  const original = matrix.matrixRequest;
  let accepted = false;
  const lost = vi
    .spyOn(matrix, "matrixRequest")
    .mockImplementation(async (...args) => {
      const result = await original(...args);
      if (
        !accepted &&
        args[0] === "PUT" &&
        args[1].includes("/send/m.room.message/zoen-contribution-")
      ) {
        accepted = true;
        throw new matrix.MatrixError({ reason: "unavailable" });
      }
      return result;
    });
  try {
    expect(
      await publishCommunityContribution(fixture.first.personal, {
        ...fixture.input,
        operationId,
      })
    ).toEqual({ status: "pending", operationId });
  } finally {
    lost.mockRestore();
  }
  expect(accepted).toBe(true);
  const readOnly = vi.spyOn(matrix, "matrixRequest");
  try {
    expect(
      await readContributionReceipt(fixture.first.personal, operationId)
    ).toEqual({ status: "pending", operationId });
    expect(readOnly.mock.calls.filter(([method]) => method !== "GET")).toEqual(
      []
    );
    await expect(
      publishCommunityContribution(fixture.first.personal, {
        ...fixture.input,
        operationId,
        text: "Changed message must never reuse this ID",
      })
    ).rejects.toMatchObject({ reason: "conflict" });
    expect(readOnly.mock.calls.filter(([method]) => method !== "GET")).toEqual(
      []
    );
  } finally {
    readOnly.mockRestore();
  }
  const retries = await Promise.all([
    publishCommunityContribution(fixture.first.personal, {
      ...fixture.input,
      operationId,
    }),
    publishCommunityContribution(fixture.first.personal, {
      ...fixture.input,
      operationId,
    }),
  ]);
  expect(retries[0]).toEqual(retries[1]);
  expect(retries[0]?.status).toBe("published");
  const messages = (
    await readMatrixMessages(fixture.first.actor, fixture.firstRoom.id)
  ).messages;
  expect(
    messages.filter((item) => item.text === fixture.input.text)
  ).toHaveLength(1);
});

test("changed room audience requires fresh discovery and approval before any contribution can be published", async () => {
  await using fixture = await communityFixture();
  await joinMatrixRoom(fixture.first.guest, fixture.firstRoom.id);
  const operationId = randomUUID();
  await expect(
    publishCommunityContribution(fixture.first.personal, {
      ...fixture.input,
      operationId,
    })
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  expect(
    await query(
      sql`SELECT 1 FROM matrix_contribution_receipts WHERE operation_id = ${operationId}`
    )
  ).toEqual([]);
  const destination = (
    await discoverContributionChannels(fixture.first.personal)
  ).destinations.find((item) => item.channelId === fixture.firstRoom.id);
  expect(destination?.revision).not.toBe(fixture.destination.revision);
  if (!destination)
    throw new Error("Authorized new audience must be rediscovered");
  expect(
    (
      await publishCommunityContribution(fixture.first.personal, {
        ...fixture.input,
        destination,
        operationId: randomUUID(),
      })
    ).status
  ).toBe("published");
});

test("Postgres receipt failure after native publication remains pending and retries without a duplicate", async () => {
  await using fixture = await communityFixture();
  const ddl = new Pool({ connectionString: env.DATABASE_URL_UNPOOLED, max: 1 });
  onTestFinished(() => ddl.end());
  const name = `community_receipt_failure_${randomUUID().replaceAll("-", "")}`;
  const operationId = fixture.input.operationId;
  await ddl.query(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'Synthetic contribution receipt failure'; END $$`);
  try {
    await ddl.query(`CREATE TRIGGER ${name} BEFORE UPDATE ON matrix_contribution_receipts
      FOR EACH ROW WHEN (NEW.operation_id = '${operationId}'::uuid) EXECUTE FUNCTION ${name}()`);
    expect(
      await publishCommunityContribution(fixture.first.personal, fixture.input)
    ).toEqual({ status: "pending", operationId });
    expect(
      await readContributionReceipt(fixture.first.personal, operationId)
    ).toEqual({ status: "pending", operationId });
  } finally {
    await ddl.query(
      `DROP TRIGGER IF EXISTS ${name} ON matrix_contribution_receipts`
    );
    await ddl.query(`DROP FUNCTION ${name}()`);
  }
  expect(
    (await publishCommunityContribution(fixture.first.personal, fixture.input))
      .status
  ).toBe("published");
  expect(
    (
      await readMatrixMessages(fixture.first.actor, fixture.firstRoom.id)
    ).messages.filter((item) => item.text === fixture.input.text)
  ).toHaveLength(1);
});

test.each([
  "left",
  "revoked-membership",
  "pending-audience",
  "revoked-channel",
  "renamed-channel",
  "expired-session",
])(
  "%s after a private proposal blocks publication without disclosing its content or receipt",
  async (change) => {
    await using fixture = await communityFixture();
    if (change === "left")
      await changeMatrixGroupMembership(fixture.first.actor, {
        id: fixture.firstRoom.id,
        action: "leave",
      });
    if (change === "revoked-membership")
      await query(
        sql`DELETE FROM workspace_memberships WHERE workspace_id = ${fixture.first.actor.workspaceId} AND user_id = ${fixture.first.actor.userId}`
      );
    if (change === "pending-audience")
      await query(
        sql`UPDATE matrix_room_members SET native_pending = true WHERE binding_id = ${fixture.firstRoom.id}`
      );
    if (change === "revoked-channel")
      await query(
        sql`UPDATE workspace_group_bindings SET revoked_at = now() WHERE id = ${fixture.firstRoom.id}`
      );
    if (change === "renamed-channel")
      await query(
        sql`UPDATE workspace_group_bindings SET label = 'Changed audience label' WHERE id = ${fixture.firstRoom.id}`
      );
    if (change === "expired-session")
      await query(
        sql`UPDATE public.session SET "expiresAt" = now() - interval '1 minute' WHERE id = ${fixture.first.personal.authSessionId}`
      );
    const operationId = randomUUID();
    const send = vi.spyOn(matrix, "matrixRequest");
    try {
      await expect(
        publishCommunityContribution(fixture.first.personal, {
          ...fixture.input,
          operationId,
        })
      ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
      expect(send.mock.calls.filter(([method]) => method !== "GET")).toEqual(
        []
      );
    } finally {
      send.mockRestore();
    }
    expect(
      await query(
        sql`SELECT 1 FROM matrix_contribution_receipts WHERE operation_id = ${operationId}`
      )
    ).toEqual([]);
  }
);

test("company sessions, group contexts, delegated sessions and aborted owner calls cannot publish personal contributions", async () => {
  await using fixture = await communityFixture();
  const execution = workspaceExecutionFor(fixture.first.personal);
  const company = workspaceExecutionFor(fixture.first.actor);
  expect(
    await contributions.events["session.started"]?.(
      undefined,
      nativeContext(company)
    )
  ).toBeNull();
  const group = {
    ...execution,
    session: {
      ...execution.session,
      auth: {
        ...execution.session.auth,
        current: {
          ...execution.session.auth.current,
          attributes: {
            ...execution.session.auth.current.attributes,
            chatKind: "group",
          },
        },
      },
    },
  };
  expect(
    await contributions.events["session.started"]?.(
      undefined,
      nativeContext(group)
    )
  ).toBeNull();
  const child = {
    ...execution,
    session: {
      ...execution.session,
      parent: toolContextFor({ parentSessionId: randomUUID() }).session.parent,
    },
  };
  const controller = new AbortController();
  controller.abort();
  for (const denied of [
    group,
    child,
    { ...execution, abortSignal: controller.signal },
  ])
    await expect(
      callNativeTool(denied, "community-contribute", fixture.input)
    ).rejects.toThrow();
  await expect(
    publishCommunityContribution(fixture.first.actor, fixture.input)
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  expect(
    await query(
      sql`SELECT 1 FROM matrix_contribution_receipts WHERE workspace_id = ${fixture.first.personal.workspaceId}`
    )
  ).toEqual([]);
});
