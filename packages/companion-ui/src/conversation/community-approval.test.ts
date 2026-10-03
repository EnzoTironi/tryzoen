import { expect, test } from "vitest";
import {
  CommunityContributionInputSchema,
  renderApprovalDisclosure,
} from "./approval";

const contribution = {
  destination: {
    workspaceId: "company:cedarbay",
    channelId: "11111111-1111-4111-8111-111111111111",
    roomId: "!approved-room:zoen.test",
    communityName: "Cedarbay",
    channelName: "Research",
    revision: "a".repeat(64),
  },
  purpose: "Offer this approved excerpt; personal reasoning stays private.",
  text: 'First exact line.\nMiddle with "quotes", café and 🦉.\nFinal exact line.',
  operationId: "22222222-2222-4222-8222-222222222222",
};

test("community approval discloses the exact channel, purpose, full text and retry identity", () => {
  const before = structuredClone(contribution);
  const result = renderApprovalDisclosure("community-contribute", contribution);
  expect(result.kind).toBe("ready");
  if (result.kind !== "ready") throw new Error("Missing exact disclosure");
  for (const value of Object.values(contribution.destination))
    expect(result.text).toContain(value);
  expect(result.text).toContain(JSON.stringify(contribution.purpose));
  expect(result.text).toContain(JSON.stringify(contribution.text));
  expect(result.text).toContain(contribution.operationId);
  expect(result.text).toContain("only the message text is published");
  expect(contribution).toEqual(before);
});

test.each([
  { text: "" },
  { text: "  \n" },
  { purpose: "  " },
  { purpose: "bad\uD800" },
  { text: "bad\uDFFF" },
  { text: "\n".repeat(8000) },
  { text: `X${"\u0000".repeat(7999)}` },
  { text: "x".repeat(8001) },
  { purpose: undefined },
  { destination: undefined },
  { destination: { ...contribution.destination, revision: "new" } },
  { destination: { ...contribution.destination, channelId: "wrong" } },
  { destination: { ...contribution.destination, roomId: "" } },
  { destination: { ...contribution.destination, communityName: "bad\uD800" } },
  { operationId: "wrong" },
  { approvalMessage: "Only disclose this public summary" },
])(
  "malformed or incomplete community contribution fails closed: %j",
  (change) => {
    const input = { ...contribution, ...change };
    expect(CommunityContributionInputSchema.safeParse(input).success).toBe(
      false
    );
    expect(renderApprovalDisclosure("community-contribute", input).kind).toBe(
      "invalid"
    );
  }
);

test("every approved contribution discloses its stable identity for an explicit retry", () => {
  const { operationId: _operationId, ...input } = contribution;
  expect(CommunityContributionInputSchema.safeParse(input).success).toBe(false);
  expect(renderApprovalDisclosure("community-contribute", input).kind).toBe(
    "invalid"
  );
});
