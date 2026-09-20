import { z } from "zod";
import { expect, test } from "vitest";
import { privateMessageTool } from "../../../server/tools/native/private-message-tool";

test("Eve persists native Zod tool schemas and rejects invalid or extra arguments", async () => {
  const input = privateMessageTool("telegram").inputSchema;
  if (!(input instanceof z.ZodType))
    throw new Error("Expected the native Zod schema");
  const json = input["~standard"].jsonSchema.input({ target: "draft-07" });
  expect(JSON.parse(JSON.stringify(json))).toEqual(json);
  expect(json).toMatchObject({
    type: "object",
    additionalProperties: false,
    properties: { text: { type: "string", maxLength: 16384 } },
  });
  expect(
    await input["~standard"].validate({
      kind: "message",
      text: "A stable fact",
    })
  ).toEqual({ value: { kind: "message", text: "A stable fact" } });
  expect(
    (await input["~standard"].validate({ kind: "message", text: "" })).issues
  ).toBeDefined();
  expect(
    (
      await input["~standard"].validate({
        kind: "message",
        text: "Fact",
        credentials: "forbidden",
      })
    ).issues
  ).toBeDefined();
});
