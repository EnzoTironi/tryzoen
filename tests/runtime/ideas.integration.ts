import { expect, test } from "vitest";
import {
  acceptPersonalIdea,
  listPersonalIdeas,
  proposePersonalIdea,
  ratePersonalIdea,
} from "@db/services/ideas";
import { workspaceFixture } from "./workspace-fixture";

test("concurrent idea acceptance freezes one task and keeps teammate feedback isolated", async () => {
  await using fixture = await workspaceFixture();
  const idea = await proposePersonalIdea(fixture.actor, {
    key: "reading-plan",
    title: "Reading plan",
    description: "Read for fifteen minutes.",
    rationale: "The synthetic owner asked for a reading routine.",
    category: "Learning",
    emoji: "📚",
    prompt: "Write a seven-day reading plan.",
  });
  const starts = await Promise.all(
    Array.from({ length: 20 }, (_, index) =>
      acceptPersonalIdea(fixture.actor, idea.id, `auth-${index}`)
    )
  );
  expect(new Set(starts.map((item) => item.startAuthSessionId)).size).toBe(1);
  expect(new Set(starts.map((item) => item.id))).toEqual(new Set([idea.id]));
  expect((await listPersonalIdeas(fixture.actor)).items).toHaveLength(1);
  expect((await listPersonalIdeas(fixture.guest)).items).toHaveLength(0);
  await expect(
    ratePersonalIdea(fixture.guest, { id: idea.id, feedback: "dismissed" })
  ).rejects.toThrow("Idea not found");
  await expect(
    acceptPersonalIdea(fixture.guest, idea.id, fixture.guest.authSessionId)
  ).rejects.toThrow("Idea not found");
});
