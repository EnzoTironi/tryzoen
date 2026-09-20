import { describe, expect, it } from "vitest";
import {
  addReactionToMessageOutputSchema,
  reactionTextFor,
  reactToMessageOutputSchema,
  reactToMessageToolResultSchema,
} from "./reaction";

const reactions = [
  ["thumbs_up", "👍"],
  ["thumbs_down", "👎"],
  ["heart", "❤️"],
  ["laugh", "😂"],
  ["exclamation", "‼️"],
  ["question", "❓"],
] as const;

describe("reaction contract", () => {
  it("defaults omitted operation and rejects null", () => {
    for (const schema of [
      reactToMessageOutputSchema,
      addReactionToMessageOutputSchema,
    ]) {
      expect(schema.parse({ type: "heart" })).toEqual({
        type: "heart",
        operation: "add",
      });
      for (const operation of [null]) {
        expect(!schema.safeParse({ type: "heart", operation }).success).toBe(
          true
        );
      }
    }
    expect(
      reactToMessageToolResultSchema.parse({
        kind: "tool-result",
        toolName: "react_to_message",
        output: { type: "heart" },
      })
    ).toEqual({
      kind: "tool-result",
      toolName: "react_to_message",
      output: { type: "heart", operation: "add" },
    });
    for (const operation of [null]) {
      expect(
        !reactToMessageToolResultSchema.safeParse({
          kind: "tool-result",
          toolName: "react_to_message",
          output: { type: "heart", operation },
        }).success
      ).toBe(true);
    }
  });
  it.each(reactions)("preserves %s and its display text", (type, text) => {
    expect(reactionTextFor(type)).toBe(text);
    expect(reactToMessageOutputSchema.parse({ type })).toEqual({
      operation: "add",
      type,
    });
    expect(addReactionToMessageOutputSchema.parse({ type })).toEqual({
      operation: "add",
      type,
    });
    for (const operation of ["add", "remove"]) {
      expect(
        reactToMessageOutputSchema.parse({
          type,
          operation,
        })
      ).toEqual({ type, operation });
    }
  });

  it.each([
    null,
    {},
    { type: null },
    { type: "HEART" },
    { type: " heart " },
    { type: "heart", operation: null },
    { type: "heart", operation: "" },
    { type: "heart", operation: "replace" },
    { type: 1 },
    [],
  ])("rejects invalid input %j", (input) => {
    expect(reactToMessageOutputSchema.safeParse(input).success).toBe(false);
    expect(addReactionToMessageOutputSchema.safeParse(input).success).toBe(
      false
    );
  });

  it("only allows add on the web contract", () => {
    expect(
      addReactionToMessageOutputSchema.safeParse({
        type: "heart",
        operation: "remove",
      }).success
    ).toBe(false);
    expect(
      addReactionToMessageOutputSchema.parse({
        type: "heart",
        operation: "add",
      })
    ).toEqual({ type: "heart", operation: "add" });
  });

  it("strips transport envelope metadata and defaults the nested operation", () => {
    expect(
      reactToMessageToolResultSchema.parse({
        kind: "tool-result",
        toolName: "react_to_message",
        callId: "c",
        output: { type: "heart" },
      })
    ).toEqual({
      kind: "tool-result",
      toolName: "react_to_message",
      output: { type: "heart", operation: "add" },
    });
    for (const input of [
      {
        kind: "other",
        toolName: "react_to_message",
        output: { type: "heart" },
      },
      { kind: "tool-result", toolName: "other", output: { type: "heart" } },
      { kind: "tool-result", toolName: "react_to_message", output: null },
    ]) {
      expect(reactToMessageToolResultSchema.safeParse(input).success).toBe(
        false
      );
    }
  });
});
