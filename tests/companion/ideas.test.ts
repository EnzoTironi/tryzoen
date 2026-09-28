import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import * as Database from "@db";
import * as schema from "@db/schema";
import { ensureScope } from "@db/services/scope";
import {
  acceptPersonalIdea,
  listPersonalIdeas,
  proposePersonalIdea,
  ratePersonalIdea,
  recordIdeaExecution,
} from "@db/services/ideas";
import { accessScopeForUser } from "@shared/identity/access-scope";

const client = new PGlite();
const database = drizzle(client, { schema });
const alice = accessScopeForUser("ideas-alice");
const bob = accessScopeForUser("ideas-bob");
const proposal = {
  key: "reading-plan",
  title: "Plan a reading habit",
  description: "Fit reading into a busy week.",
  rationale: "You said you want to read more.",
  category: "Learning" as const,
  emoji: "📚",
  prompt:
    "Help me choose a daily reading routine. Ask about my available time.",
};

beforeAll(async () => {
  await migrate(database, { migrationsFolder: "db/migrations" });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Real queries and constraints against an isolated PostgreSQL-compatible driver.
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

it("keeps ideas and feedback private even between members of the same workspace", async () => {
  const idea = await proposePersonalIdea(alice, proposal);
  await database.insert(schema.workspaceMemberships).values({
    workspaceId: alice.workspaceId,
    userId: bob.userId,
    role: "member",
  });
  const teammate = { ...bob, workspaceId: alice.workspaceId };
  for (const other of [bob, teammate]) {
    expect((await listPersonalIdeas(other)).items).toEqual([]);
    await expect(
      ratePersonalIdea(other, { id: idea.id, feedback: "more" })
    ).rejects.toThrow("Idea not found");
    await expect(
      acceptPersonalIdea(other, idea.id, "other-auth")
    ).rejects.toThrow("Idea not found");
  }
  expect((await listPersonalIdeas(alice)).items[0]?.feedback).toBeNull();
});

it("deduplicates proposals and retains negative feedback without reviving a topic", async () => {
  const idea = await proposePersonalIdea(alice, proposal);
  await ratePersonalIdea(alice, { id: idea.id, feedback: "dismissed" });
  const retry = await proposePersonalIdea(alice, {
    ...proposal,
    title: "Reworded topic",
    prompt: "Different work",
  });
  expect(retry).toEqual({ ...idea, feedback: "dismissed" });
  expect((await listPersonalIdeas(alice)).items).toEqual([]);
  const history = await listPersonalIdeas(alice, null, true);
  expect(history.items[0]).toMatchObject({
    title: proposal.title,
    feedback: "dismissed",
  });
  await expect(acceptPersonalIdea(alice, idea.id, "auth-a")).rejects.toThrow(
    "dismissed"
  );
});

it("freezes one accepted task across concurrent starts and never treats feedback as permission", async () => {
  const idea = await proposePersonalIdea(alice, proposal);
  await ratePersonalIdea(alice, { id: idea.id, feedback: "more" });
  expect((await listPersonalIdeas(alice)).items[0]?.status).toBe("suggested");
  const starts = await Promise.all([
    acceptPersonalIdea(alice, idea.id, "first-auth"),
    acceptPersonalIdea(alice, idea.id, "second-auth"),
  ]);
  expect(new Set(starts.map((item) => item.startAuthSessionId)).size).toBe(1);
  expect(starts.every((item) => item.status === "starting")).toBe(true);
  expect(await database.select().from(schema.personalIdeas)).toHaveLength(1);
});

it("tracks real events without letting a late event or another session overwrite progress", async () => {
  const idea = await proposePersonalIdea(alice, proposal);
  const accepted = await acceptPersonalIdea(alice, idea.id, "auth");
  const start = new Date(accepted.statusAt.getTime() + 1000);
  const end = new Date(start.getTime() + 1000);
  await recordIdeaExecution(
    alice,
    idea.id,
    "session-one",
    "running",
    start,
    "001"
  );
  await recordIdeaExecution(
    alice,
    idea.id,
    "session-one",
    "finished",
    end,
    "003"
  );
  await recordIdeaExecution(
    alice,
    idea.id,
    "session-one",
    "running",
    start,
    "001"
  );
  await recordIdeaExecution(
    alice,
    idea.id,
    "session-two",
    "failed",
    new Date(end.getTime() + 1000),
    "004"
  );
  expect((await listPersonalIdeas(alice)).items[0]).toMatchObject({
    status: "finished",
    sessionId: "session-one",
  });
  await recordIdeaExecution(
    alice,
    idea.id,
    "session-one",
    "running",
    end,
    "002"
  );
  expect((await listPersonalIdeas(alice)).items[0]?.status).toBe("finished");
  await ratePersonalIdea(alice, { id: idea.id, feedback: "dismissed" });
  expect((await listPersonalIdeas(alice, null, true)).items[0]?.status).toBe(
    "finished"
  );
});

it("pages tied timestamps without leaking the internal authorization reference", async () => {
  const createdAt = new Date("2026-09-27T12:00:00Z");
  await database.insert(schema.personalIdeas).values(
    Array.from({ length: 61 }, (_, index) => ({
      ...alice,
      id: randomUUID(),
      key: `topic-${index}`,
      proposal: { ...proposal, key: `topic-${index}` },
      createdAt,
      startAuthSessionId: "private-auth-reference",
    }))
  );
  const first = await listPersonalIdeas(alice);
  const second = await listPersonalIdeas(alice, first.nextCursor);
  const third = await listPersonalIdeas(alice, second.nextCursor);
  const items = [...first.items, ...second.items, ...third.items];
  expect([first.items.length, second.items.length, third.items.length]).toEqual(
    [30, 30, 1]
  );
  expect(new Set(items.map((item) => item.id)).size).toBe(61);
  expect(third.nextCursor).toBeNull();
  expect(JSON.stringify(items)).not.toContain("private-auth-reference");
});

it("removes private proposals when membership is revoked and cannot recreate them", async () => {
  const idea = await proposePersonalIdea(alice, proposal);
  await database
    .delete(schema.workspaceMemberships)
    .where(
      and(
        eq(schema.workspaceMemberships.workspaceId, alice.workspaceId),
        eq(schema.workspaceMemberships.userId, alice.userId)
      )
    );
  expect((await listPersonalIdeas(alice)).items).toEqual([]);
  await expect(acceptPersonalIdea(alice, idea.id, "old-auth")).rejects.toThrow(
    "membership"
  );
  await expect(proposePersonalIdea(alice, proposal)).rejects.toThrow(
    "Failed query"
  );
});
