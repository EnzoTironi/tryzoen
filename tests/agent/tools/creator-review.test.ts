import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { z } from "zod";
import review from "../../../agent/tools/creator-review";
import interview from "../../../agent/tools/creator-interview";

test("a model can select an evaluation, but cannot supply the human verdict or identity", async () => {
  const schema = review.inputSchema;
  if (!(schema instanceof z.ZodType))
    throw new Error("Expected the authored schema");
  const id = randomUUID();
  expect(await schema["~standard"].validate({ id })).toEqual({ value: { id } });
  for (const field of [
    "verdict",
    "notes",
    "criteria",
    "expectedRevision",
    "userId",
    "workspaceId",
  ])
    expect(
      await schema["~standard"].validate({ id, [field]: "useful" })
    ).toHaveProperty("issues");
  expect(review.availableInSubagents).toBe(false);
});

test("the interview tool requires an existing revision and cannot accept model-authored answers or approval", async () => {
  const schema = interview.inputSchema;
  if (!(schema instanceof z.ZodType))
    throw new Error("Expected the authored schema");
  const input = { id: randomUUID(), expectedRevision: randomUUID() };
  expect(await schema["~standard"].validate(input)).toEqual({ value: input });
  expect(
    await schema["~standard"].validate({ ...input, expectedRevision: null })
  ).toHaveProperty("issues");
  for (const field of [
    "answers",
    "playbook",
    "approved",
    "userId",
    "workspaceId",
  ])
    expect(
      await schema["~standard"].validate({ ...input, [field]: "untrusted" })
    ).toHaveProperty("issues");
  expect(interview.availableInSubagents).toBe(false);
});
