import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { z } from "zod";
import { expect, test } from "vitest";
import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import { env } from "@shared/environment/env";
import { workspaceFileView } from "../../agent/lib/files/view";
import {
  invokeWorkspaceTool,
  readWorkspaceToolCatalog,
} from "../../server/tools/workspace";
import { workspaceExecutionFor, workspaceFixture } from "./workspace-fixture";
import { linkedIdentity } from "./identity-fixture";
import { callNativeTool } from "../helpers/native-tools";
import {
  authenticateAgentGrant,
  issueAgentGrant,
  revokeAgentGrant,
  saveWorkspaceBot,
} from "../../server/workspaces/bots";
import { registerExternalAgentMember } from "../../server/workspaces/agent-members";

const path = "knowledge/race.md";
const fileCalls = [
  { path: "workspace_files_list", args: {} },
  { path: "workspace_files_read", args: { path } },
  { path: "workspace_files_search", args: { query: "marker" } },
];
function outcome<T>(promise: Promise<T>) {
  return promise.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error })
  );
}
async function connection() {
  if (!env.DATABASE_URL_UNPOOLED)
    throw new Error("Missing isolated barrier database URL");
  const url = new URL(env.DATABASE_URL_UNPOOLED);
  const application = new URL(env.DATABASE_URL);
  if (
    url.hostname !== "127.0.0.1" ||
    url.host !== application.host ||
    url.pathname !== application.pathname ||
    url.pathname !== "/companion_runtime_test"
  )
    throw new Error(
      "File admission barriers require the same exclusively allocated loopback test database"
    );
  const client = new Client({
    connectionString: url.href,
    application_name: "file-admission-barrier",
    statement_timeout: 10_000,
    lock_timeout: 8_000,
  });
  await client.connect();
  const identity = await client.query<{
    pid: number;
    name: string;
    role: string;
  }>(
    "SELECT pg_backend_pid() AS pid, current_database() AS name, current_user AS role"
  );
  const row = identity.rows[0];
  if (row?.name !== "companion_runtime_test" || row.role !== "zoen_migrator")
    throw new Error("Barrier database identity mismatch");
  return {
    client,
    pid: row.pid,
    async [Symbol.asyncDispose]() {
      await client.query("ROLLBACK");
      await client.end();
    },
  };
}
// SQL polling asserts a real waiter; diagnostic rejection is not an alternate assertion.
// oxlint-disable vitest/no-conditional-expect
async function blocked(monitor: Client, blocker: number, pattern: string) {
  let pid: number | undefined;
  await expect
    .poll(
      async () => {
        const result = await monitor.query<{ pid: number }>(
          "SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND $1 = ANY(pg_blocking_pids(pid)) AND query LIKE $2",
          [blocker, `%${pattern}%`]
        );
        pid = result.rows[0]?.pid;
        return pid;
      },
      { timeout: 6_000, interval: 10 }
    )
    .toBeTypeOf("number")
    .catch(async (cause: unknown) => {
      const graph = await monitor.query(
        "SELECT pid, usename, wait_event_type, pg_blocking_pids(pid) AS blockers, query FROM pg_stat_activity WHERE datname=current_database()"
      );
      throw new Error(
        `Missing waiter ${blocker}/${pattern}: ${JSON.stringify(graph.rows)}`,
        { cause }
      );
    });
  if (pid === undefined) throw new Error("Expected observed PostgreSQL waiter");
  return pid;
}
// oxlint-enable vitest/no-conditional-expect

async function writerSession(
  actor: Awaited<ReturnType<typeof workspaceFixture>>["actor"]
) {
  const id = randomUUID();
  await query(
    sql`INSERT INTO public.session (id, token, "userId", "expiresAt", "updatedAt") SELECT ${id}, ${id}, "userId", "expiresAt", now() FROM public.session WHERE id = ${actor.authSessionId}`
  );
  return { ...actor, authSessionId: id };
}

// Real PostgreSQL waiter graph, repository Git publication and application dispatch.
// No authority interception, mock responses, fake timers or application test hooks.
test.each(
  fileCalls.flatMap((call) => [
    { ...call, empty: false },
    { ...call, empty: true },
  ])
)(
  "first current $path empty=$empty rejects catalog A / data B",
  async (call) => {
    await using workspace = await workspaceFixture();
    const { actor, repository } = workspace;
    const writer = await writerSession(actor);
    let admittedRevision: string | null = null;
    if (!call.empty) {
      const initial = await repository.write(actor, {
        operationId: randomUUID(),
        expectedRevision: null,
        path,
        content: "A-marker",
      });
      const admitted = await repository.write(actor, {
        operationId: randomUUID(),
        expectedRevision: initial.revision,
        path: "plugins/workspace.json",
        content: JSON.stringify({ version: 1, enabled: ["files"] }),
      });
      admittedRevision = admitted.revision;
    }
    await using table = await connection();
    await using session = await connection();
    await using monitor = await connection();
    await table.client.query("BEGIN");
    await table.client.query(
      "LOCK workspace_repository IN ACCESS EXCLUSIVE MODE"
    );
    const reading = outcome(invokeWorkspaceTool(actor, call));
    let holding: Promise<unknown> | undefined;
    try {
      const reader = await blocked(monitor.client, table.pid, "head_sha");
      await session.client.query("BEGIN");
      holding = session.client.query(
        "SELECT id FROM public.session WHERE id = $1 FOR UPDATE",
        [actor.authSessionId]
      );
      await blocked(monitor.client, reader, "FOR UPDATE");
      await table.client.query("COMMIT");
      await holding;
      await blocked(monitor.client, session.pid, "public.session");
      const changed = await repository.write(writer, {
        operationId: randomUUID(),
        expectedRevision: admittedRevision,
        path,
        content: "B-must-not-escape-marker",
      });
      await repository.write(writer, {
        operationId: randomUUID(),
        expectedRevision: changed.revision,
        path: "plugins/workspace.json",
        content: JSON.stringify({ version: 1, enabled: [] }),
      });
      await session.client.query("COMMIT");
      expect(await reading).toMatchObject({
        ok: false,
        error: { _tag: "WorkspaceRepositoryError", reason: "conflict" },
      });
      await expect(invokeWorkspaceTool(actor, call)).rejects.toMatchObject({
        _tag: "ToolAccessDenied",
      });
    } finally {
      await table.client.query("ROLLBACK");
      await session.client.query("ROLLBACK");
      await holding;
      await reading;
    }
  }
);

test("stable native personal/company reads, captured principal, history and empty workspace", async () => {
  await using workspace = await workspaceFixture();
  const { actor, personal, guestPersonal, repository } = workspace;
  const empty = workspaceFileView(workspaceExecutionFor(personal));
  expect(await empty.list()).toEqual({
    revision: null,
    entries: [],
    nextOffset: null,
  });
  await expect(empty.read(`/workspace/${path}`)).rejects.toThrow("not found");
  for (const owner of [actor, personal, guestPersonal]) {
    await repository.write(owner, {
      operationId: randomUUID(),
      expectedRevision: null,
      path,
      content: owner.workspaceId,
    });
  }
  const execution = workspaceExecutionFor(personal);
  const view = workspaceFileView(execution);
  execution.session.auth.current.attributes.workspaceId = actor.workspaceId;
  expect((await view.read(`/workspace/${path}`)).content).toBe(
    personal.workspaceId
  );
  expect(
    await callNativeTool(workspaceExecutionFor(actor), "workspace_files_read", {
      path,
    })
  ).toMatchObject({ content: actor.workspaceId });
  const forged = { ...personal, workspaceId: guestPersonal.workspaceId };
  await expect(
    workspaceFileView(workspaceExecutionFor(forged)).list()
  ).rejects.toMatchObject({ _tag: "WorkspaceAccessDenied" });
  const old = await repository.read(actor);
  const current = await repository.publish(actor, {
    operationId: randomUUID(),
    expectedRevision: old.revision,
    changes: [
      { path, content: null },
      { path: "knowledge/moved.md", content: "moved" },
    ],
  });
  expect(
    await invokeWorkspaceTool(actor, {
      path: "workspace_files_read",
      args: { path, revision: old.revision },
    })
  ).toMatchObject({ revision: old.revision, content: actor.workspaceId });
  expect(
    await invokeWorkspaceTool(actor, {
      path: "workspace_files_list",
      args: { revision: old.revision },
    })
  ).toMatchObject({ revision: old.revision, files: [path] });
  expect(
    await invokeWorkspaceTool(actor, {
      path: "workspace_files_search",
      args: { query: actor.workspaceId, revision: old.revision },
    })
  ).toMatchObject({ revision: old.revision });
  for (const call of fileCalls)
    expect(
      await invokeWorkspaceTool(actor, {
        ...call,
        args: { ...call.args, asOf: "2000-01-01T00:00:00Z" },
      })
    ).toMatchObject({ revision: null });
  await repository.publish(actor, {
    operationId: randomUUID(),
    expectedRevision: current.revision,
    changes: [
      {
        path: "plugins/workspace.json",
        content: JSON.stringify({ version: 1, enabled: [] }),
      },
    ],
  });
  await expect(
    invokeWorkspaceTool(actor, {
      path: "workspace_files_read",
      args: { path, revision: old.revision },
    })
  ).rejects.toMatchObject({ _tag: "ToolAccessDenied" });
});

test("real grant admission, private/history denial and revocation after listing", async () => {
  await using workspace = await workspaceFixture();
  const { actor, repository } = workspace;
  const first = await repository.write(actor, {
    operationId: randomUUID(),
    expectedRevision: null,
    path,
    content: "shared",
  });
  const initial = await repository.write(actor, {
    operationId: randomUUID(),
    expectedRevision: first.revision,
    path: "agent/USER.md",
    content: "private",
  });
  const bot = await saveWorkspaceBot(actor, {
    username: `f${randomUUID().replaceAll("-", "").slice(0, 20)}`,
    name: "File admission",
    description: "Synthetic fixture",
    discoverable: false,
  });
  const { member } = await registerExternalAgentMember(actor, {
    operationId: randomUUID(),
    username: "file_reader",
    name: "Synthetic reader",
  });
  const limited = await issueAgentGrant(actor, {
    label: "ontology only",
    capabilities: ["ontology"],
    days: 1,
    externalMemberId: member.id,
  });
  const { actor: withoutFiles } = await authenticateAgentGrant(
    `Bearer ${limited.token}`,
    bot.username
  );
  await expect(
    invokeWorkspaceTool(withoutFiles, {
      path: "workspace_files_list",
      args: {},
    })
  ).rejects.toMatchObject({ _tag: "ToolAccessDenied" });
  const grant = await issueAgentGrant(actor, {
    label: "files",
    capabilities: ["files"],
    days: 1,
    externalMemberId: member.id,
  });
  const { actor: external } = await authenticateAgentGrant(
    `Bearer ${grant.token}`,
    bot.username
  );
  expect(
    await invokeWorkspaceTool(external, {
      path: "workspace_files_list",
      args: {},
    })
  ).toMatchObject({ files: [path] });
  expect(
    await invokeWorkspaceTool(external, {
      path: "workspace_files_read",
      args: { path },
    })
  ).toMatchObject({ content: "shared" });
  await expect(
    invokeWorkspaceTool(external, {
      path: "workspace_files_read",
      args: { path: "agent/USER.md" },
    })
  ).rejects.toMatchObject({ _tag: "WorkspaceAccessDenied" });
  await expect(
    invokeWorkspaceTool(external, {
      path: "workspace_files_read",
      args: { path, revision: initial.revision },
    })
  ).rejects.toMatchObject({ _tag: "WorkspaceAccessDenied" });
  await revokeAgentGrant(actor, grant.id);
  await expect(
    invokeWorkspaceTool(external, { path: "workspace_files_list", args: {} })
  ).rejects.toMatchObject({ _tag: "WorkspaceAccessDenied" });
});

test.each(
  ["publication", "disable", "membership", "session"].flatMap((change) =>
    ["workspace_files_list", "workspace_files_read"].map((tool) => ({
      change,
      tool,
    }))
  )
)(
  "final $tool admission withholds already-read data after $change",
  async ({ change, tool }) => {
    await using workspace = await workspaceFixture();
    const { actor, repository } = workspace;
    const writer = await writerSession(actor);
    const a = await repository.write(actor, {
      operationId: randomUUID(),
      expectedRevision: null,
      path,
      content: "A-marker",
    });
    await using table = await connection();
    await using session = await connection();
    await using monitor = await connection();
    await table.client.query("BEGIN");
    await table.client.query(
      "LOCK workspace_revision IN ACCESS EXCLUSIVE MODE"
    );
    const reading = outcome(
      invokeWorkspaceTool(actor, {
        path: tool,
        args: tool === "workspace_files_list" ? {} : { path },
      })
    );
    let holding: Promise<unknown> | undefined;
    try {
      const reader = await blocked(
        monitor.client,
        table.pid,
        "SELECT revision FROM workspace_revision"
      );
      await session.client.query("BEGIN");
      holding =
        change === "membership"
          ? session.client.query(
              "SELECT user_id FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2 FOR UPDATE",
              [actor.workspaceId, actor.userId]
            )
          : session.client.query(
              "SELECT id FROM public.session WHERE id = $1 FOR UPDATE",
              [actor.authSessionId]
            );
      await blocked(monitor.client, reader, "FOR UPDATE");
      await table.client.query("COMMIT");
      await holding;
      await blocked(
        monitor.client,
        session.pid,
        change === "membership" ? "workspace_memberships" : "public.session"
      );
      if (change === "publication" || change === "disable") {
        await repository.write(writer, {
          operationId: randomUUID(),
          expectedRevision: a.revision,
          path: change === "publication" ? path : "plugins/workspace.json",
          content:
            change === "publication"
              ? "B-marker"
              : JSON.stringify({ version: 1, enabled: [] }),
        });
      } else if (change === "session") {
        await session.client.query(
          "UPDATE public.session SET \"expiresAt\" = now() - interval '1 second' WHERE id = $1",
          [actor.authSessionId]
        );
      } else {
        await session.client.query(
          "DELETE FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2",
          [actor.workspaceId, actor.userId]
        );
      }
      await session.client.query("COMMIT");
      const expected =
        change === "publication"
          ? { _tag: "WorkspaceRepositoryError", reason: "conflict" }
          : {
              _tag:
                change === "disable"
                  ? "ToolAccessDenied"
                  : "WorkspaceAccessDenied",
            };
      expect(await reading).toMatchObject({ ok: false, error: expected });
    } finally {
      await table.client.query("ROLLBACK");
      await session.client.query("ROLLBACK");
      await holding;
      await reading;
    }
  }
);

test("real UTF-16 pagination, UTF-8 byte limit, canonical paths and retained-view drift", async () => {
  await using workspace = await workspaceFixture();
  const { actor, repository } = workspace;
  const content = "x".repeat(11_999) + "😀end";
  const a = await repository.write(actor, {
    operationId: randomUUID(),
    expectedRevision: null,
    path,
    content,
  });
  const view = workspaceFileView(workspaceExecutionFor(actor));
  expect((await view.read(`/workspace/${path}`)).content).toBe(content);
  for (const invalid of [
    "/etc/passwd",
    "/workspace/../secret",
    "/workspace/knowledge/../race.md",
    "/workspace/knowledge//race.md",
    "/workspace/knowledge/%2e%2e/race.md",
    "/workspace/knowledge/./race.md",
    "/workspace/knowledge\\race.md",
    "/workspace/knowledge/race.md\0",
  ])
    await expect(view.read(invalid)).rejects.toThrow(Error);
  await expect(
    repository.write(actor, {
      operationId: randomUUID(),
      expectedRevision: a.revision,
      path,
      content: "界".repeat(90_000),
    })
  ).rejects.toMatchObject({
    _tag: "WorkspaceRepositoryError",
    reason: "invalid_input",
  });
  await expect(
    repository.write(actor, {
      operationId: randomUUID(),
      expectedRevision: a.revision,
      path: "knowledge/link/../secret.md",
      content: "alias",
    })
  ).rejects.toThrow(z.ZodError);
  const exact = "界".repeat(87_381) + "x";
  await repository.write(actor, {
    operationId: randomUUID(),
    expectedRevision: a.revision,
    path,
    content: exact,
  });
  await expect(view.read(`/workspace/${path}`)).rejects.toThrow(
    "revision changed"
  );
  expect(
    Buffer.byteLength(
      (
        await workspaceFileView(workspaceExecutionFor(actor)).read(
          `/workspace/${path}`
        )
      ).content
    )
  ).toBe(262_144);
});

test.each(
  ["revoke", "remove-files"].flatMap((change) =>
    ["workspace_files_list", "workspace_files_read"].map((tool) => ({
      change,
      tool,
    }))
  )
)(
  "final $tool grant sample denies $change at unchanged publication",
  async ({ change, tool }) => {
    await using workspace = await workspaceFixture();
    const { actor, repository } = workspace;
    await repository.write(actor, {
      operationId: randomUUID(),
      expectedRevision: null,
      path,
      content: "private-to-grant",
    });
    const bot = await saveWorkspaceBot(actor, {
      username: `f${randomUUID().replaceAll("-", "").slice(0, 20)}`,
      name: "Grant race",
      description: "Synthetic fixture",
      discoverable: false,
    });
    const { member } = await registerExternalAgentMember(actor, {
      operationId: randomUUID(),
      username: "grant_reader",
      name: "Synthetic reader",
    });
    const grant = await issueAgentGrant(actor, {
      label: "files",
      capabilities: ["files"],
      days: 1,
      externalMemberId: member.id,
    });
    const { actor: external } = await authenticateAgentGrant(
      `Bearer ${grant.token}`,
      bot.username
    );
    await using table = await connection();
    await using monitor = await connection();
    await table.client.query("BEGIN");
    await table.client.query(
      "LOCK workspace_revision IN ACCESS EXCLUSIVE MODE"
    );
    const reading = outcome(
      invokeWorkspaceTool(external, {
        path: tool,
        args: tool === "workspace_files_list" ? {} : { path },
      })
    );
    let removal: Promise<unknown> | undefined;
    try {
      const reader = await blocked(
        monitor.client,
        table.pid,
        "SELECT revision FROM workspace_revision"
      );
      removal =
        change === "revoke"
          ? revokeAgentGrant(actor, grant.id)
          : query(
              sql`UPDATE workspace_agent_grants SET capabilities = '["ontology"]'::jsonb WHERE id = ${grant.id}`
            );
      await blocked(monitor.client, reader, "UPDATE workspace_agent_grants");
      await table.client.query("COMMIT");
      await removal;
      expect(await reading).toMatchObject({
        ok: false,
        error: {
          _tag:
            change === "revoke" ? "WorkspaceAccessDenied" : "ToolAccessDenied",
        },
      });
    } finally {
      await table.client.query("ROLLBACK");
      await removal;
      await reading;
    }
  }
);

test("real verified group excludes private paths, history and revoked bindings", async () => {
  await using workspace = await workspaceFixture();
  const { actor, guest, repository } = workspace;
  const a = await repository.write(actor, {
    operationId: randomUUID(),
    expectedRevision: null,
    path,
    content: "shared",
  });
  await repository.write(actor, {
    operationId: randomUUID(),
    expectedRevision: a.revision,
    path: "agent/USER.md",
    content: "private-marker",
  });
  const installationId = `file-view-${randomUUID()}`;
  const identity = await linkedIdentity(
    { channel: "telegram", installationId, senderId: "member" },
    { userId: guest.userId.slice("better-auth:".length) }
  );
  const binding = randomUUID();
  await query(
    sql`INSERT INTO workspace_group_bindings(id, workspace_id, channel, installation_id, conversation_id, label, created_by) VALUES (${binding}, ${actor.workspaceId}, 'telegram', ${installationId}, ${randomUUID()}, 'File test', ${actor.userId})`
  );
  const execution = workspaceExecutionFor(guest);
  const principal = {
    principalId: guest.userId,
    principalType: "user",
    authenticator: "verified-channel",
    attributes: {
      workspaceId: actor.workspaceId,
      channelIdentityId: identity.id,
      groupBindingId: binding,
      chatKind: "group",
    },
  };
  const view = workspaceFileView({
    session: {
      ...execution.session,
      auth: { current: principal, initiator: principal },
    },
  });
  expect((await view.list()).entries).toEqual([`/workspace/${path}`]);
  expect((await view.read(`/workspace/${path}`)).content).toBe("shared");
  await expect(view.read("/workspace/agent/USER.md")).rejects.toMatchObject({
    _tag: "WorkspaceAccessDenied",
  });
  const group = {
    userId: guest.userId,
    workspaceId: actor.workspaceId,
    channelIdentityId: identity.id,
    groupBindingId: binding,
  };
  await expect(
    invokeWorkspaceTool(group, {
      path: "workspace_files_list",
      args: { revision: a.revision },
    })
  ).rejects.toMatchObject({ _tag: "WorkspaceAccessDenied" });
  expect(
    (await readWorkspaceToolCatalog(group)).tools.map((tool) => tool.path)
  ).not.toContain("workspace_memory_search");
  await query(
    sql`UPDATE workspace_group_bindings SET revoked_at = now() WHERE id = ${binding}`
  );
  await expect(view.read(`/workspace/${path}`)).rejects.toMatchObject({
    _tag: "WorkspaceAccessDenied",
  });
});

test("real bounded list pagination and invalid cursors", async () => {
  await using workspace = await workspaceFixture();
  const { actor, repository } = workspace;
  let revision: string | null = null;
  for (let offset = 0; offset < 101; offset += 24) {
    const published = await repository.publish(actor, {
      operationId: randomUUID(),
      expectedRevision: revision,
      changes: Array.from({ length: Math.min(24, 101 - offset) }, (_, i) => ({
        path: `knowledge/n${String(offset + i).padStart(3, "0")}.md`,
        content: "entry",
      })),
    });
    revision = published.revision;
  }
  const view = workspaceFileView(workspaceExecutionFor(actor));
  const first = await view.list();
  expect(first.entries).toHaveLength(100);
  expect(first.nextOffset).toBe(100);
  expect(await view.list(100)).toEqual({
    revision,
    entries: ["/workspace/knowledge/n100.md"],
    nextOffset: null,
  });
  for (const offset of [-1, 0.5, 1001, NaN])
    await expect(view.list(offset)).rejects.toThrow(Error);
  // The real Git owner caps trees at 200, before the view's defensive 1,000 cap.
  for (let offset = 101; offset < 200; offset += 24) {
    const published = await repository.publish(actor, {
      operationId: randomUUID(),
      expectedRevision: revision,
      changes: Array.from({ length: Math.min(24, 200 - offset) }, (_, i) => ({
        path: `knowledge/n${String(offset + i).padStart(3, "0")}.md`,
        content: "entry",
      })),
    });
    revision = published.revision;
  }
  await expect(
    repository.write(actor, {
      operationId: randomUUID(),
      expectedRevision: revision,
      path: "knowledge/overflow.md",
      content: "entry",
    })
  ).rejects.toMatchObject({
    _tag: "WorkspaceRepositoryError",
    reason: "invalid_input",
  });
});

test("real catalog exposes memory only with both runtime settings in private context", async () => {
  await using workspace = await workspaceFixture();
  const { actor } = workspace;
  const catalog = await readWorkspaceToolCatalog(actor);
  expect(
    catalog.tools.some((tool) => tool.path === "workspace_memory_search")
  ).toBe(Boolean(env.ZOEN_SESSION_ARCHIVE_DIR && env.ZOEN_AI_MEMORY_BINARY));
  expect(catalog.tools.map((tool) => tool.path)).toContain(
    "workspace_files_read"
  );
  expect(catalog.tools.map((tool) => tool.path)).toContain(
    "workspace_ontology_read"
  );
  if (!env.ZOEN_SESSION_ARCHIVE_DIR || !env.ZOEN_AI_MEMORY_BINARY) {
    // oxlint-disable-next-line vitest/no-conditional-expect -- Each actual environment variant is run in its own process.
    await expect(
      invokeWorkspaceTool(actor, {
        path: "workspace_memory_search",
        args: { query: "synthetic" },
      })
    ).rejects.toMatchObject({ _tag: "ToolAccessDenied" });
  }
});

test.each(["publication", "session"])(
  "a real %s change between file pages never returns partial content",
  async (change) => {
    await using workspace = await workspaceFixture();
    const { actor, repository } = workspace;
    const writer = await writerSession(actor);
    const a = await repository.write(actor, {
      operationId: randomUUID(),
      expectedRevision: null,
      path,
      content: "A".repeat(12_001),
    });
    await using table = await connection();
    await using first = await connection();
    await using next = await connection();
    await using monitor = await connection();
    await table.client.query("BEGIN");
    await table.client.query(
      "LOCK workspace_revision IN ACCESS EXCLUSIVE MODE"
    );
    const reading = outcome(
      workspaceFileView(workspaceExecutionFor(actor)).read(`/workspace/${path}`)
    );
    let firstLock: Promise<unknown> | undefined;
    let nextLock: Promise<unknown> | undefined;
    try {
      const dataReader = await blocked(
        monitor.client,
        table.pid,
        "SELECT revision FROM workspace_revision"
      );
      await first.client.query("BEGIN");
      firstLock = first.client.query(
        "SELECT id FROM public.session WHERE id = $1 FOR UPDATE",
        [actor.authSessionId]
      );
      await blocked(monitor.client, dataReader, "FOR UPDATE");
      await table.client.query("COMMIT");
      await firstLock;
      const finalCatalog = await blocked(
        monitor.client,
        first.pid,
        "public.session"
      );
      await next.client.query("BEGIN");
      nextLock = next.client.query(
        "SELECT id FROM public.session WHERE id = $1 FOR UPDATE",
        [actor.authSessionId]
      );
      // The next holder must queue behind the final catalog's tuple waiter.
      await blocked(monitor.client, finalCatalog, "FOR UPDATE");
      await first.client.query("COMMIT");
      await nextLock;
      await blocked(monitor.client, next.pid, "public.session");
      if (change === "publication") {
        await repository.write(writer, {
          operationId: randomUUID(),
          expectedRevision: a.revision,
          path,
          content: "B".repeat(12_001),
        });
      } else {
        await next.client.query(
          "UPDATE public.session SET \"expiresAt\" = now() - interval '1 second' WHERE id = $1",
          [actor.authSessionId]
        );
      }
      await next.client.query("COMMIT");
      const expected =
        change === "publication"
          ? { message: "Workspace revision changed; reopen the view" }
          : { _tag: "WorkspaceAccessDenied" };
      expect(await reading).toMatchObject({ ok: false, error: expected });
    } finally {
      await table.client.query("ROLLBACK");
      await first.client.query("ROLLBACK");
      await next.client.query("ROLLBACK");
      await firstLock;
      await nextLock;
      await reading;
    }
  }
);
