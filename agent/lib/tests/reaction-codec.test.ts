import { jsonString } from "@shared/validation";
import { z } from "zod";
import { asSchema } from "ai";
import { describe, expect, it } from "vitest";
import messaging from "../../tools/messaging";
import {
  addReactionToMessageOutputSchema,
  reactToMessageOutputSchema,
} from "../../../shared/chat/reaction";
import {
  isToolSchema,
  serializeInputSchema,
  toInputSchema,
} from "../../../node_modules/eve/dist/src/tools/schema.js";
const decodeJsonObject = jsonString(z.record(z.string(), z.json()));

// Real dynamic tools and installed Eve/AI SDK codecs; no provider I/O.
describe.each(["http", "channel:linq"])("reaction codec for %s", (channel) => {
  it("preserves defaults, allowed operations and strict input validation across JSON persistence", async () => {
    const handler = messaging.events["turn.started"];
    if (!handler) throw new Error("Messaging turn handler is required.");
    const tools = await handler(
      {},
      {
        model: null,
        channel: {
          kind: channel,
        },
        messages: [],
        session: {
          id: "reaction-codec",
          auth: {
            current: null,
            initiator: null,
          },
        },
      }
    );
    if (
      !(typeof tools === "object" && tools !== null) ||
      !("react_to_message" in tools)
    )
      throw new Error("Reaction tool is required.");
    const reaction = tools.react_to_message;
    if (
      !(typeof reaction === "object" && reaction !== null) ||
      !("inputSchema" in reaction)
    )
      throw new Error("Reaction schema is required.");
    const original = reaction.inputSchema;
    expect(isToolSchema(original)).toBe(true);
    if (!isToolSchema(original))
      throw new Error("Reaction must use Standard Schema.");
    expect(await asSchema(original).jsonSchema).toMatchObject({
      type: "object",
    });
    const encoded = decodeJsonObject.parse(
      JSON.stringify(serializeInputSchema(original))
    );
    expect(encoded).toMatchObject({
      type: "object",
      properties: {
        operation: {},
      },
      required: ["type"],
    });
    const restored = toInputSchema(encoded);
    expect(isToolSchema(restored)).toBe(true);
    expect(await asSchema(restored).jsonSchema).toMatchObject({
      type: "object",
    });
    expect(serializeInputSchema(restored)).toMatchObject({
      type: "object",
    });
    const canonical =
      channel === "channel:linq"
        ? reactToMessageOutputSchema
        : addReactionToMessageOutputSchema;
    const valid = [
      {
        type: "thumbs_up",
      },
      {
        type: "thumbs_down",
      },
      {
        type: "heart",
      },
      {
        type: "laugh",
      },
      {
        type: "exclamation",
      },
      {
        type: "question",
      },
      {
        type: "heart",
        operation: "add",
      },
      ...(channel === "channel:linq"
        ? [
            {
              type: "heart",
              operation: "remove",
            },
          ]
        : []),
    ];
    const invalid = [
      null,
      {},
      [],
      {
        type: null,
      },
      {
        type: "HEART",
      },
      {
        type: " heart ",
      },
      {
        type: "heart",
        operation: null,
      },
      {
        type: "heart",
        operation: "replace",
      },
      {
        type: "heart",
        extra: true,
      },
      ...(channel === "http"
        ? [
            {
              type: "heart",
              operation: "remove",
            },
          ]
        : []),
    ];
    await Promise.all(
      [toInputSchema(original), restored].flatMap((schema) =>
        valid
          .map(async (input) => {
            const result = await schema["~standard"].validate(input);
            expect(result.issues).toBeUndefined();
            if (result.issues) throw new Error("Valid reaction was rejected.");
            expect(result.value).toMatchObject({
              operation: input.operation ?? "add",
              type: input.type,
            });
            expect(canonical.parse(result.value)).toEqual(
              canonical.parse(input)
            );
          })
          .concat(
            invalid.map(async (input) => {
              const result = await schema["~standard"].validate(input);
              expect(result.issues?.length).toBeGreaterThan(0);
            })
          )
      )
    );
  });
});
