import { describe, expect, it } from "vitest";
import { PayloadReferenceSchema } from "./contract";

const reference = {
  workspaceId: "roadmap-synthetic-workspace",
  ownerGeneration: "a2d64b0a-8e5a-4b3d-8b3f-fc07a7ce2ed1",
  candidateId: "935e9b25-35b6-4553-903d-27ff481572b9",
  sha256: "a".repeat(64),
  ownerUserId: null,
};

describe("private payload byte coordinates", () => {
  it.each([
    { kind: "workspace-bundle", minimum: 0, maximum: 25_165_824 },
    { kind: "workspace-source", minimum: 0, maximum: 10_485_760 },
    { kind: "private-memory-bundle", minimum: 1, maximum: 25_165_824 },
    { kind: "private-artifact", minimum: 1, maximum: 10_485_760 },
  ])("enforces the $kind owner's byte range", ({ kind, minimum, maximum }) => {
    const owned = {
      ...reference,
      ownerUserId: kind.startsWith("private-")
        ? "better-auth:synthetic-owner"
        : null,
    };
    expect(
      PayloadReferenceSchema.safeParse({
        ...owned,
        kind,
        byteLength: minimum,
      }).success
    ).toBe(true);
    expect(
      PayloadReferenceSchema.safeParse({
        ...owned,
        kind,
        byteLength: maximum,
      }).success
    ).toBe(true);
    expect(
      PayloadReferenceSchema.safeParse({
        ...owned,
        kind,
        byteLength: minimum - 1,
      }).success
    ).toBe(false);
    expect(
      PayloadReferenceSchema.safeParse({
        ...owned,
        kind,
        byteLength: maximum + 1,
      }).success
    ).toBe(false);
  });

  it.each([
    { workspaceId: "" },
    { ownerGeneration: "a different owner's generation" },
    { candidateId: "a mutable object path" },
    { kind: "a-public-url" },
    { sha256: "not-a-content-hash" },
    { byteLength: 1.5 },
    { endpoint: "https://an-unapproved-endpoint.invalid" },
    { ownerUserId: "better-auth:synthetic-owner" },
    { kind: "private-memory-bundle", ownerUserId: null },
    { kind: "private-artifact", ownerUserId: "" },
    { kind: "private-artifact", ownerUserId: " better-auth:synthetic-owner" },
    { kind: "private-artifact", ownerUserId: undefined },
  ])("rejects invalid coordinates %j", (invalid) => {
    expect(
      PayloadReferenceSchema.safeParse({
        ...reference,
        kind: "workspace-bundle",
        byteLength: 1,
        ...invalid,
      }).success
    ).toBe(false);
  });
});
