import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import { mapAsync } from "../../server/operations/async";
import { randomUUID } from "node:crypto";

import { expect, test } from "vitest";
import { workspaceFixture } from "./workspace-fixture";

import {
  authenticateAgentGrant,
  issueAgentGrant,
  readWorkspaceBot,
  revokeAgentGrant,
  saveWorkspaceBot,
  searchWorkspaceBots,
} from "../../server/workspaces/bots";
import { requireWorkspaceAccess } from "../../server/workspaces/access";
import {
  acceptProtocolTask,
  bindProtocolSession,
  cancelProtocolTask,
  awaitProtocolTask,
  finishProtocolTask,
  readProtocolTask,
} from "../../server/a2a/tasks";
import { listProtocolTasks } from "../../server/a2a/list";
import { readWorkspaceToolCatalog } from "../../server/tools/workspace";
import { readAgentCard } from "../../server/a2a/card";

const profile = () => ({
  username: `b${randomUUID().replaceAll("-", "").slice(0, 20)}`,
  name: "Test Zoen",
  description: "Synthetic knowledge assistant",
  discoverable: false,
});
const grantInput = {
  label: "Test agent",
  capabilities: ["files" as const],
  days: 1,
};
const denied = (
  result: { ok: true; value: unknown } | { ok: false; error: unknown }
) => {
  expect(!result.ok).toBe(true);
};

test("bot discovery is opt-in and grants never cross bot or workspace boundaries", async () => {
  await using workspace = await workspaceFixture();
  const { actor, guest, personal } = workspace;
  const bot = await saveWorkspaceBot(actor, profile());
  expect(await searchWorkspaceBots(actor, bot.username)).toEqual([]);
  denied(
    await Promise.try(async () => readAgentCard(bot.username, null)).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error })
    )
  );
  denied(
    await Promise.try(async () => saveWorkspaceBot(guest, profile())).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error })
    )
  );
  denied(
    await Promise.try(async () => issueAgentGrant(guest, grantInput)).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error })
    )
  );
  const grant = await issueAgentGrant(actor, grantInput);
  const authorized = await authenticateAgentGrant(
    `Bearer ${grant.token}`,
    bot.username
  );
  expect(authorized.actor.workspaceId).toBe(actor.workspaceId);
  const privateBot = await saveWorkspaceBot(personal, profile());
  denied(
    await Promise.try(async () =>
      authenticateAgentGrant(`Bearer ${grant.token}`, privateBot.username)
    ).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error })
    )
  );
  denied(
    await Promise.try(async () =>
      requireWorkspaceAccess({
        ...authorized.actor,
        workspaceId: personal.workspaceId,
      })
    ).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error })
    )
  );
  denied(
    await Promise.try(async () =>
      requireWorkspaceAccess({
        ...authorized.actor,
        authSessionId: actor.authSessionId,
      })
    ).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error })
    )
  );
  await saveWorkspaceBot(actor, { ...bot, discoverable: true });
  expect(await searchWorkspaceBots(actor, bot.username)).toHaveLength(1);
  expect(await searchWorkspaceBots(guest, bot.username)).toHaveLength(1);
  expect(await searchWorkspaceBots(personal, bot.username)).toEqual([]);
  expect(
    (await readAgentCard(bot.username, null)).supportedInterfaces[0]
      ?.protocolVersion
  ).toBe("1.0");
  expect((await readWorkspaceBot(guest)).grants).toEqual([]);
});

test("concurrent delivery, cancellation before binding, and late completion keep one terminal task", async () => {
  await using workspace = await workspaceFixture();
  const { actor } = workspace;
  const bot = await saveWorkspaceBot(actor, profile());
  const grant = await issueAgentGrant(actor, grantInput);
  const { actor: external } = await authenticateAgentGrant(
    `Bearer ${grant.token}`,
    bot.username
  );
  const input = {
    message: {
      messageId: randomUUID(),
      role: "ROLE_USER" as const,
      parts: [{ text: "One task" }],
    },
  };
  const results = await mapAsync(
    Array.from({ length: 8 }),
    () => acceptProtocolTask(external, input),
    8
  );
  expect(new Set(results.map((task) => task.id)).size).toBe(1);
  const first = results[0];
  if (!first) throw new Error("No accepted task");
  const id = first.id;
  await requireWorkspaceAccess({ ...external, protocolTaskId: id });
  await cancelProtocolTask(external, id);
  await bindProtocolSession(external, id, "late-native-session");
  await finishProtocolTask(external, id, "TASK_STATE_COMPLETED", "Late answer");
  expect((await cancelProtocolTask(external, id)).state).toBe(
    "TASK_STATE_CANCELED"
  );
  expect((await awaitProtocolTask(external, id)).output).toBeNull();
  denied(
    await Promise.try(async () =>
      requireWorkspaceAccess({ ...external, protocolTaskId: id })
    ).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error })
    )
  );
});

test("A2A pages have stable cursors, exact totals, filters and grant isolation", async () => {
  await using workspace = await workspaceFixture();
  const { actor } = workspace;
  const bot = await saveWorkspaceBot(actor, profile());
  const grant = await issueAgentGrant(actor, grantInput);
  const otherGrant = await issueAgentGrant(actor, grantInput);
  const { actor: external } = await authenticateAgentGrant(
    `Bearer ${grant.token}`,
    bot.username
  );
  const { actor: other } = await authenticateAgentGrant(
    `Bearer ${otherGrant.token}`,
    bot.username
  );
  for (let index = 0; index < 7; index++) {
    const task = await acceptProtocolTask(external, {
      message: {
        messageId: randomUUID(),
        role: "ROLE_USER",
        parts: [{ text: `Task ${String(index)}` }],
      },
    });
    await finishProtocolTask(
      external,
      task.id,
      "TASK_STATE_COMPLETED",
      "Answer"
    );
  }
  const first = await listProtocolTasks(external, { pageSize: 3 });
  const second = await listProtocolTasks(external, {
    pageSize: 3,
    pageToken: first.nextPageToken,
    includeArtifacts: true,
  });
  const last = await listProtocolTasks(external, {
    pageSize: 3,
    pageToken: second.nextPageToken,
  });
  expect(first.totalSize).toBe(7);
  expect(first.pageSize).toBe(3);
  expect(last.tasks).toHaveLength(1);
  expect(last.nextPageToken).toBe("");
  expect(
    new Set(
      [...first.tasks, ...second.tasks, ...last.tasks].map((task) => task.id)
    ).size
  ).toBe(7);
  expect(JSON.stringify(first.tasks)).not.toContain('"artifacts"');
  expect(second.tasks[0]?.artifacts).toHaveLength(1);
  denied(
    await Promise.try(async () =>
      listProtocolTasks(other, {
        pageToken: first.nextPageToken,
      })
    ).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error })
    )
  );
  denied(
    await Promise.try(async () =>
      listProtocolTasks(external, {
        pageToken: first.nextPageToken,
        status: "TASK_STATE_FAILED",
      })
    ).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error })
    )
  );
  expect(
    (await listProtocolTasks(external, { status: "TASK_STATE_FAILED" }))
      .totalSize
  ).toBe(0);
});

test("revocation, expiry and issuer removal deny every subsequent agent operation", async () => {
  await using workspace = await workspaceFixture();
  const { actor } = workspace;
  const bot = await saveWorkspaceBot(actor, profile());
  const grant = await issueAgentGrant(actor, grantInput);
  const { actor: external } = await authenticateAgentGrant(
    `Bearer ${grant.token}`,
    bot.username
  );
  await revokeAgentGrant(actor, grant.id);
  denied(
    await Promise.try(async () => readWorkspaceToolCatalog(external)).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error })
    )
  );
  denied(
    await Promise.try(async () =>
      authenticateAgentGrant(`Bearer ${grant.token}`, bot.username)
    ).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error })
    )
  );
  const expiring = await issueAgentGrant(actor, grantInput);
  await query(
    sql`UPDATE workspace_agent_grants SET expires_at = now() - interval '1 second' WHERE id = ${expiring.id}`
  );
  denied(
    await Promise.try(async () =>
      authenticateAgentGrant(`Bearer ${expiring.token}`, bot.username)
    ).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error })
    )
  );
  const removed = await issueAgentGrant(actor, grantInput);
  expect(removed.id).not.toBe(grant.id);
  await query(
    sql`DELETE FROM workspace_memberships WHERE user_id = ${actor.userId} AND workspace_id = ${actor.workspaceId}`
  );
  denied(
    await Promise.try(async () =>
      authenticateAgentGrant(`Bearer ${removed.token}`, bot.username)
    ).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error })
    )
  );
});

test("external agents only read shared current files and cannot export memory, history or write", async () => {
  await using workspace = await workspaceFixture();
  const { actor, personal, repository } = workspace;
  const bot = await saveWorkspaceBot(personal, profile());
  const first = await repository.write(personal, {
    operationId: randomUUID(),
    expectedRevision: null,
    path: "knowledge/shared.md",
    content: "Version one",
  });
  const second = await repository.write(personal, {
    operationId: randomUUID(),
    expectedRevision: first.revision,
    path: "agent/USER.md",
    content: "Private profile",
  });
  const grant = await issueAgentGrant(personal, grantInput);
  const { actor: external } = await authenticateAgentGrant(
    `Bearer ${grant.token}`,
    bot.username
  );
  expect((await repository.read(external)).files).toEqual([
    "knowledge/shared.md",
  ]);
  expect(
    (await repository.selection(external, ["agent/USER.md"])).documents
  ).toEqual([]);
  denied(
    await Promise.try(async () =>
      repository.read(external, "agent/USER.md")
    ).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error })
    )
  );
  denied(
    await Promise.try(async () =>
      repository.read(external, "knowledge/shared.md", first.revision)
    ).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error })
    )
  );
  denied(
    await Promise.try(async () =>
      repository.history(external, "knowledge/shared.md")
    ).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error })
    )
  );
  denied(
    await Promise.try(async () => repository.export(external)).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error })
    )
  );
  denied(
    await Promise.try(async () =>
      repository.write(external, {
        operationId: randomUUID(),
        expectedRevision: second.revision,
        path: "knowledge/shared.md",
        content: "Injected edit",
      })
    ).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error })
    )
  );
  denied(
    await Promise.try(async () =>
      repository.read({ ...external, workspaceId: actor.workspaceId })
    ).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error })
    )
  );
  expect(
    (await readWorkspaceToolCatalog(external)).tools.map((tool) => tool.path)
  ).toEqual([
    "workspace_files_list",
    "workspace_files_read",
    "workspace_files_search",
  ]);
});

test("A2A messages are idempotent and tasks and contexts are private to their grant", async () => {
  await using workspace = await workspaceFixture();
  const { actor } = workspace;
  const bot = await saveWorkspaceBot(actor, profile());
  const firstGrant = await issueAgentGrant(actor, grantInput);
  const secondGrant = await issueAgentGrant(actor, grantInput);
  const { actor: first } = await authenticateAgentGrant(
    `Bearer ${firstGrant.token}`,
    bot.username
  );
  const { actor: second } = await authenticateAgentGrant(
    `Bearer ${secondGrant.token}`,
    bot.username
  );
  const input = {
    message: {
      messageId: randomUUID(),
      role: "ROLE_USER" as const,
      parts: [{ text: "Read the shared plan" }],
    },
  };
  const task = await acceptProtocolTask(first, input);
  expect((await acceptProtocolTask(first, input)).id).toBe(task.id);
  denied(
    await Promise.try(async () =>
      acceptProtocolTask(first, {
        message: { ...input.message, parts: [{ text: "Changed replay" }] },
      })
    ).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error })
    )
  );
  denied(
    await Promise.try(async () => readProtocolTask(second, task.id)).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error })
    )
  );
  denied(
    await Promise.try(async () =>
      acceptProtocolTask(second, {
        message: { ...input.message, contextId: task.contextId },
      })
    ).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error })
    )
  );
  expect((await listProtocolTasks(second)).tasks).toEqual([]);
  await finishProtocolTask(
    first,
    task.id,
    "TASK_STATE_COMPLETED",
    "Plan reviewed"
  );
  await finishProtocolTask(
    first,
    task.id,
    "TASK_STATE_FAILED",
    "Late stale event"
  );
  expect((await readProtocolTask(first, task.id)).output).toBe("Plan reviewed");
  await revokeAgentGrant(actor, firstGrant.id);
  denied(
    await Promise.try(async () => readProtocolTask(first, task.id)).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error })
    )
  );
});
