import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import * as Database from "@db";
import * as schema from "@db/schema";
import { ensureScope } from "@db/services/scope";
import { saveWorkstream, readWorkstream } from "@db/services/workstreams";
import {
  accessScopeForUser,
  type AccessScope,
} from "@shared/identity/access-scope";
import { createTRPCRouter } from "@web/trpc/init";
import { companionRouter } from "@web/trpc/companion";
import * as WorkspaceSession from "../../server/workspaces/session";
import { WorkspaceAccessDenied } from "../../server/workspaces/access";
import { WorkspaceRepository } from "../../server/workspaces/repository";

const client = new PGlite();
const database = drizzle(client, { schema });
const alice = accessScopeForUser("alice");
const bob = accessScopeForUser("bob");
const router = createTRPCRouter(companionRouter);

beforeAll(async () => {
  await migrate(database, { migrationsFolder: "db/migrations" });
  // SAFETY: The query builders are identical; only the isolated PostgreSQL-compatible driver changes.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Exercise the actual schema, constraints and queries in an isolated database.
  vi.spyOn(Database, "db", "get").mockReturnValue(database as never);
}, 20_000);

beforeEach(async () => {
  await database.delete(schema.workspaces);
  await ensureScope(alice);
  await ensureScope(bob);
});

afterAll(async () => {
  vi.restoreAllMocks();
  await client.close();
});

function caller(scope: AccessScope) {
  vi.spyOn(WorkspaceSession, "resolveWorkspaceActor").mockResolvedValue({
    ...scope,
    role: "owner",
    organizationId: null,
  });
  return router.createCaller({ requestHeaders: new Headers(), scope });
}

it("persists independent goal display options without sharing them with another member", async () => {
  const api = caller(alice);
  expect(await api.goalPreferences()).toEqual({
    showSubtitles: true,
    sortAutomatically: true,
  });
  await Promise.all([
    api.setGoalPreference({ key: "showSubtitles", value: false }),
    api.setGoalPreference({ key: "sortAutomatically", value: false }),
  ]);
  expect(await api.goalPreferences()).toEqual({
    showSubtitles: false,
    sortAutomatically: false,
  });
  // Replaying one setting must not revert a concurrent change to the other.
  await api.setGoalPreference({ key: "showSubtitles", value: false });
  expect((await api.goalPreferences()).sortAutomatically).toBe(false);
  await database.insert(schema.workspaceMemberships).values({
    workspaceId: alice.workspaceId,
    userId: bob.userId,
    role: "member",
  });
  const teammate = caller({ ...bob, workspaceId: alice.workspaceId });
  expect(await teammate.goalPreferences()).toEqual({
    showSubtitles: true,
    sortAutomatically: true,
  });
  await teammate.setGoalPreference({ key: "showSubtitles", value: false });
  expect(await caller(bob).goalPreferences()).toEqual({
    showSubtitles: true,
    sortAutomatically: true,
  });
  expect(await caller(alice).goalPreferences()).toEqual({
    showSubtitles: false,
    sortAutomatically: false,
  });
});

it("removes goal preferences on membership revocation and refuses further access", async () => {
  const api = caller(alice);
  await api.setGoalPreference({ key: "showSubtitles", value: false });
  await database
    .delete(schema.workspaceMemberships)
    .where(
      and(
        eq(schema.workspaceMemberships.workspaceId, alice.workspaceId),
        eq(schema.workspaceMemberships.userId, alice.userId)
      )
    );
  expect(await database.select().from(schema.goalPreferences)).toEqual([]);
  vi.spyOn(WorkspaceSession, "resolveWorkspaceActor").mockRejectedValue(
    new WorkspaceAccessDenied()
  );
  await expect(api.goalPreferences()).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  await expect(
    api.setGoalPreference({ key: "sortAutomatically", value: false })
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(await database.select().from(schema.goalPreferences)).toEqual([]);
});

it("pages conversations without losing tied timestamps and excludes other users", async () => {
  await database.insert(schema.workspaceMemberships).values({
    workspaceId: alice.workspaceId,
    userId: bob.userId,
    role: "member",
  });
  const now = new Date("2026-09-27T12:00:00Z");
  const sessions = Array.from({ length: 61 }, (_, index) => ({
    sessionId: `alice-${String(index).padStart(3, "0")}`,
    workspaceId: alice.workspaceId,
    createdByUserId: alice.userId,
  }));
  await database.insert(schema.agentSessions).values([
    ...sessions,
    {
      sessionId: "teammate",
      workspaceId: alice.workspaceId,
      createdByUserId: bob.userId,
    },
    {
      sessionId: "private",
      workspaceId: bob.workspaceId,
      createdByUserId: bob.userId,
    },
  ]);
  await database.insert(schema.chats).values([
    ...sessions.map((session) => ({
      sessionId: session.sessionId,
      workspaceId: session.workspaceId,
      title: "Planning",
      updatedAt: now,
    })),
    {
      sessionId: "teammate",
      workspaceId: alice.workspaceId,
      title: "Private teammate conversation",
      updatedAt: now,
    },
    {
      sessionId: "private",
      workspaceId: bob.workspaceId,
      title: "Private workspace",
      updatedAt: now,
    },
  ]);
  const api = caller(alice);
  const first = await api.chats({});
  const second = await api.chats({ cursor: first.nextCursor });
  const third = await api.chats({ cursor: second.nextCursor });
  expect([first.items.length, second.items.length, third.items.length]).toEqual(
    [30, 30, 1]
  );
  expect(
    new Set(
      [...first.items, ...second.items, ...third.items].map(
        (item) => item.sessionId
      )
    ).size
  ).toBe(61);
  expect(third.nextCursor).toBeNull();
  expect(
    [...first.items, ...second.items, ...third.items].every((item) =>
      item.sessionId.startsWith("alice-")
    )
  ).toBe(true);
});

it("treats search wildcard characters as literal text", async () => {
  for (const title of [
    "100% complete",
    "1000 complete",
    "under_score",
    "underXscore",
  ]) {
    const sessionId = randomUUID();
    await database
      .insert(schema.agentSessions)
      .values({ sessionId, ...alice, createdByUserId: alice.userId });
    await database
      .insert(schema.chats)
      .values({ sessionId, workspaceId: alice.workspaceId, title });
  }
  const api = caller(alice);
  expect(
    (await api.chats({ query: "%" })).items.map((item) => item.title)
  ).toEqual(["100% complete"]);
  expect(
    (await api.chats({ query: "_" })).items.map((item) => item.title)
  ).toEqual(["under_score"]);
});

it("saves goal completion idempotently, preserves its notes and rejects stale or foreign writes", async () => {
  const content = {
    title: "Reading habit",
    objective: "Read daily",
    status: "active" as const,
    notes: "After breakfast",
    nextStep: "Choose a book",
    sources: [],
  };
  await saveWorkstream(
    alice,
    "memory",
    { id: "reading", expectedRevision: 0, content },
    "initial",
    "session-reading"
  );
  const input = {
    id: "reading",
    scopeKey: "memory",
    expectedRevision: 1,
    completed: true,
    operationId: randomUUID(),
  };
  const api = caller(alice);
  const saved = await api.setGoalCompleted(input);
  expect(saved).toMatchObject({
    revision: 2,
    content: { ...content, status: "completed" },
    sessionId: "session-reading",
  });
  expect(await api.setGoalCompleted(input)).toEqual(saved);
  await expect(
    api.setGoalCompleted({
      ...input,
      operationId: randomUUID(),
      completed: false,
    })
  ).rejects.toMatchObject({ code: "CONFLICT" });
  const foreign = caller(bob);
  expect(await foreign.goals()).toEqual([]);
  await expect(foreign.setGoalCompleted(input)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  expect(await readWorkstream(alice, "memory", "reading")).toMatchObject({
    revision: 2,
    content: { status: "completed" },
  });
});

it("keeps goal revisions atomic, paginates history and erases it with a forgotten goal", async () => {
  const content = {
    title: "Reading",
    objective: "Read daily",
    status: "active" as const,
    notes: "Preserve my notes",
    nextStep: "Choose a book",
    sources: [],
  };
  await saveWorkstream(
    alice,
    "memory",
    { id: "reading", expectedRevision: 0, content },
    "initial",
    null
  );
  const api = caller(alice);
  const rename = {
    id: "reading",
    scopeKey: "memory",
    expectedRevision: 1,
    title: "Reading club",
    operationId: randomUUID(),
  };
  const result = await api.renameGoal(rename);
  expect(await api.renameGoal(rename)).toEqual(result);
  expect(result.content?.notes).toBe(content.notes);
  expect(
    (await api.goalHistory(rename)).items.map((entry) => entry.content.title)
  ).toEqual(["Reading club", "Reading"]);
  await expect(
    api.renameGoal({ ...rename, title: "Stale", operationId: randomUUID() })
  ).rejects.toMatchObject({ code: "CONFLICT" });
  for (let revision = 2; revision < 25; revision++) {
    await saveWorkstream(
      alice,
      "memory",
      {
        id: "reading",
        expectedRevision: revision,
        content: { ...content, nextStep: `Chapter ${revision}` },
      },
      `step-${revision}`,
      null
    );
  }
  const first = await api.goalHistory({ id: "reading", scopeKey: "memory" });
  const second = await api.goalHistory({
    id: "reading",
    scopeKey: "memory",
    beforeRevision: first.nextRevision ?? undefined,
  });
  expect([first.items.length, second.items.length]).toEqual([20, 5]);
  expect(
    new Set([...first.items, ...second.items].map((entry) => entry.revision))
      .size
  ).toBe(25);
  expect(second.nextRevision).toBeNull();
  const foreign = caller(bob);
  await expect(
    foreign.goalHistory({ id: "reading", scopeKey: "memory" })
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(foreign.renameGoal(rename)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  await foreign.deleteGoal({ ...rename, expectedRevision: 25 });
  expect(await readWorkstream(alice, "memory", "reading")).not.toBeNull();
  await expect(
    caller(alice).deleteGoal({ ...rename, expectedRevision: 24 })
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(
    (await database.select().from(schema.workstreamRevisions)).length
  ).toBe(25);
  await caller(alice).deleteGoal({ ...rename, expectedRevision: 25 });
  expect(await database.select().from(schema.workstreamRevisions)).toEqual([]);
  await expect(
    caller(alice).goalHistory({ id: "reading", scopeKey: "memory" })
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
});

it("pages useful feed updates and never links a different user's conversation", async () => {
  await database.insert(schema.agentSessions).values({
    sessionId: "bob-session",
    workspaceId: bob.workspaceId,
    createdByUserId: bob.userId,
  });
  const jobId = randomUUID();
  const foreignJobId = randomUUID();
  await database.insert(schema.scheduledAgentJobs).values([
    {
      id: jobId,
      workspaceId: alice.workspaceId,
      createdByUserId: alice.userId,
      prompt: "Daily reading",
      conversationChannel: "eve",
      conversationId: "bob-session",
      timing: {},
    },
    {
      id: foreignJobId,
      workspaceId: bob.workspaceId,
      createdByUserId: bob.userId,
      prompt: "Private briefing",
      conversationChannel: "eve",
      conversationId: "bob-session",
      timing: {},
    },
  ]);
  const outcome = {
    kind: "result",
    summary: "Reading update",
    urgency: "normal",
  };
  await database.insert(schema.scheduledAgentRuns).values([
    ...Array.from({ length: 21 }, (_, index) => ({
      jobId,
      scheduledFor: new Date(Date.UTC(2026, 8, index + 1)),
      status: "completed" as const,
      outcome,
    })),
    {
      jobId,
      scheduledFor: new Date("2026-09-25"),
      status: "completed",
      outcome: { kind: "nothing_to_report", reason: "Nothing new" },
    },
    { jobId, scheduledFor: new Date("2026-09-26"), status: "running" },
    {
      jobId: foreignJobId,
      scheduledFor: new Date("2026-09-27"),
      status: "completed",
      outcome,
    },
  ]);
  const api = caller(alice);
  const first = await api.feed({});
  const last = await api.feed({ cursor: first.nextCursor });
  expect(first.items).toHaveLength(20);
  expect(last.items).toHaveLength(1);
  expect(last.nextCursor).toBeNull();
  expect(
    new Set([...first.items, ...last.items].map((item) => item.id)).size
  ).toBe(21);
  expect(
    [...first.items, ...last.items].every(
      (item) => item.sessionId === null && item.title === "Daily reading"
    )
  ).toBe(true);
});

it("rechecks workspace access for every product query", async () => {
  const api = caller(alice);
  vi.spyOn(WorkspaceSession, "resolveWorkspaceActor").mockRejectedValue(
    new WorkspaceAccessDenied()
  );
  await expect(api.chats({})).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(api.goals()).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(api.feed({})).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(api.identity()).rejects.toMatchObject({ code: "FORBIDDEN" });
});

it("reads only the three agent documents in the authenticated workspace and exposes the member restriction", async () => {
  const selection = vi
    .spyOn(WorkspaceRepository, "selection")
    .mockResolvedValue({
      revision: "a".repeat(40),
      documents: [{ path: "agent/IDENTITY.md", content: "Name: Reader" }],
    });
  try {
    const api = caller(alice);
    expect(await api.identity()).toMatchObject({
      canEdit: true,
      documents: [{ path: "agent/IDENTITY.md", content: "Name: Reader" }],
    });
    expect(selection).toHaveBeenLastCalledWith(expect.objectContaining(alice), [
      "agent/IDENTITY.md",
      "agent/SOUL.md",
      "agent/MEMORY.md",
    ]);
    vi.spyOn(WorkspaceSession, "resolveWorkspaceActor").mockResolvedValue({
      ...alice,
      role: "member",
      organizationId: null,
    });
    expect(await api.identity()).toMatchObject({ canEdit: false });
  } finally {
    selection.mockRestore();
  }
});
