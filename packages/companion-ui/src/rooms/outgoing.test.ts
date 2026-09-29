import { expect, it } from "vitest";
import { projectOutgoingRoomMessages } from "./outgoing";

const outgoing = {
  id: "transaction",
  createdAt: 123,
  status: "failed" as const,
  input: {
    id: "room",
    operationId: "transaction",
    text: "Same text",
    rootId: "$thread",
    files: [
      {
        type: "file" as const,
        filename: "photo.png",
        mediaType: "image/png",
        url: "data:image/png;base64,AAAA",
      },
    ],
  },
};
const received = {
  id: "$confirmed",
  transactionId: "transaction",
  text: "Same text",
  mine: true,
  senderId: "@me:matrix",
  sender: "Me",
  bot: false,
  timestamp: 124,
  rootId: "$thread",
  replies: 0,
  reply: null,
};

it("keeps only missing attachments after partial delivery and settles by transport identity", () => {
  const partial = projectOutgoingRoomMessages([received], [outgoing]);
  expect(partial.messages).toHaveLength(2);
  expect(partial.messages[1]?.outgoing?.file).toEqual(outgoing.input.files[0]);
  expect(partial.settled).toEqual([]);
  expect(
    projectOutgoingRoomMessages(
      [
        received,
        { ...received, id: "$file", transactionId: "transaction.file.0" },
      ],
      [outgoing]
    ).settled
  ).toEqual(["transaction"]);
});

it("never reconciles identical text or a different sender's transaction", () => {
  const result = projectOutgoingRoomMessages(
    [
      { ...received, mine: false },
      { ...received, id: "$other", transactionId: "another" },
    ],
    [outgoing]
  );
  expect(result.messages).toHaveLength(4);
  expect(result.settled).toEqual([]);
});
