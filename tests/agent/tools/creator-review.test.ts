import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { z } from "zod";
import review from "../../../agent/tools/creator-review";

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
