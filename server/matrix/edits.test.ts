import { expect, it } from "vitest";
import { MatrixEventSchema } from "./client";
import { currentReplacement, projectMatrixMessage } from "./messages";
const replacement = {
  event_id: "$edit",
  type: "m.room.message",
  sender: "@person:test",
  origin_server_ts: 2,
  content: {
    msgtype: "m.text",
    body: "* After",
    "m.new_content": { msgtype: "m.text", body: "After" },
    "m.relates_to": { rel_type: "m.replace", event_id: "$original" },
  },
};
const original = {
  event_id: "$original",
  room_id: "!room:test",
  type: "m.room.message",
  sender: "@person:test",
  origin_server_ts: 1,
  content: {
    msgtype: "m.text",
    body: "Before",
    "m.relates_to": { rel_type: "m.thread", event_id: "$root" },
  },
  unsigned: { "m.relations": { "m.replace": replacement } },
};
it("applies the validated homeserver bundle without changing thread or original identity", () => {
  expect(
    projectMatrixMessage(
      MatrixEventSchema.parse(original),
      [],
      "@person:test",
      "@bot:test"
    )
  ).toMatchObject({
    id: "$original",
    text: "After",
    rootId: "$root",
    timestamp: 1,
    editId: "$edit",
    editedAt: 2,
  });
});
it.each([
  { ...replacement, sender: "@other:test" },
  { ...replacement, room_id: "!other:test" },
  { ...replacement, state_key: "" },
  { ...replacement, type: "m.room.member" },
  {
    ...replacement,
    unsigned: { redacted_because: { event_id: "$redaction" } },
  },
  {
    ...replacement,
    content: {
      ...replacement.content,
      "m.relates_to": { rel_type: "m.replace", event_id: "$elsewhere" },
    },
  },
  {
    ...replacement,
    content: {
      ...replacement.content,
      "m.new_content": { msgtype: "m.image", body: "Secret" },
    },
  },
])("never applies an invalid replacement", (edit) => {
  expect(
    currentReplacement(
      MatrixEventSchema.parse({
        ...original,
        unsigned: { "m.relations": { "m.replace": edit } },
      })
    )
  ).toBeUndefined();
});
it("redaction wins over any edit bundle and exposes neither text nor reply", () => {
  expect(
    projectMatrixMessage(
      MatrixEventSchema.parse({
        ...original,
        unsigned: {
          ...original.unsigned,
          redacted_because: { event_id: "$redaction" },
        },
      }),
      [],
      "@person:test",
      "@bot:test"
    )
  ).toMatchObject({ text: "Mensagem removida", redacted: true, reply: null });
  expect(
    currentReplacement(
      MatrixEventSchema.parse({
        ...original,
        unsigned: { ...original.unsigned, redacted_because: {} },
      })
    )
  ).toBeUndefined();
});
it("ignores replacement relations and preserves the original reply", () => {
  const event = MatrixEventSchema.parse({
    ...original,
    content: {
      ...original.content,
      body: "> <@quoted:test> Original quote\n\nBefore",
      "m.relates_to": { "m.in_reply_to": { event_id: "$quoted" } },
    },
    unsigned: {
      "m.relations": {
        "m.replace": {
          ...replacement,
          content: {
            ...replacement.content,
            "m.new_content": {
              msgtype: "m.text",
              body: "After",
              "m.relates_to": { "m.in_reply_to": { event_id: "$injected" } },
            },
          },
        },
      },
    },
  });
  expect(
    projectMatrixMessage(event, [], "@person:test", "@bot:test").reply
  ).toMatchObject({ id: "$quoted", text: "Original quote" });
});
