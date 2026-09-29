import { expect, test } from "vitest";
import { applyRoomChanges } from "./history";

function message(id: string, rootId: string | null = null) {
  return {
    id,
    text: id,
    rootId,
    sender: "Ana",
    senderId: "@ana:test",
    mine: false,
    bot: false,
    timestamp: 1,
    replies: 0,
    reply: null,
  };
}
const page = {
  room: {
    id: "room",
    roomId: "!room:test",
    label: "Room",
    epoch: "epoch",
    kind: "group" as const,
  },
  members: [],
  membersTruncated: false,
  nextCursor: "native-older",
  messages: [message("$recent")],
};
const history = {
  pages: [page, { ...page, messages: [message("$old")], nextCursor: null }],
  pageParams: [undefined, "native-older"],
};

test("new arrivals preserve older pages, native cursors, order and replay deduplication", () => {
  const changes = { added: [message("$next"), message("$later")], updated: [] };
  const next = applyRoomChanges(history, changes);
  expect(next?.pages[0]?.messages.map((item) => item.id)).toEqual([
    "$recent",
    "$next",
    "$later",
  ]);
  expect(next?.pages[1]).toEqual(history.pages[1]);
  expect(next?.pageParams).toBe(history.pageParams);
  expect(next?.pages[0]?.nextCursor).toBe("native-older");
  expect(next && applyRoomChanges(next, changes)).toEqual(next);
});

test("an old edit updates its loaded position without adding an unloaded original", () => {
  const next = applyRoomChanges(history, {
    added: [],
    updated: [
      { ...message("$old"), text: "Updated", editId: "$edit" },
      message("$unloaded"),
    ],
  });
  expect(next?.pages[1]?.messages[0]).toMatchObject({
    id: "$old",
    text: "Updated",
    editId: "$edit",
  });
  expect(next?.pages.flatMap((item) => item.messages)).toHaveLength(2);
});

test("thread deltas only add matching replies and update their parent without inserting it", () => {
  const thread = {
    ...history,
    pages: [
      {
        ...page,
        parent: message("$root"),
        messages: [message("$reply", "$root")],
      },
    ],
  };
  const next = applyRoomChanges(thread, {
    added: [
      message("$new", "$root"),
      message("$other", "$elsewhere"),
      message("$main"),
    ],
    updated: [
      { ...message("$root"), replies: 2 },
      { ...message("$reply", "$root"), text: "Edited reply" },
    ],
  });
  expect(next?.pages[0]?.messages.map((item) => item.id)).toEqual([
    "$reply",
    "$new",
  ]);
  expect(next?.pages[0]?.messages[0]?.text).toBe("Edited reply");
  expect(next?.pages[0]?.parent?.replies).toBe(2);
});

test("a repeated arrival cannot restore removed content or undo an existing edit", () => {
  const removed = {
    ...message("$old", "$root"),
    redacted: true,
    text: "Mensagem removida",
  };
  const edited = { ...message("$recent"), text: "New edit", editId: "$edit" };
  const current = {
    ...history,
    pages: [{ ...page, messages: [removed, edited] }],
  };
  const next = applyRoomChanges(current, {
    added: [message("$old"), message("$recent")],
    updated: [message("$old")],
  });
  expect(next).toEqual(current);
  const redaction = applyRoomChanges(current, {
    added: [],
    updated: [{ ...message("$old"), redacted: true }],
  });
  expect(redaction?.pages[0]?.messages[0]?.rootId).toBe("$root");
});

test("a full live head requests recovery without trimming messages across its cursor", () => {
  const current = {
    ...history,
    pages: [
      {
        ...page,
        messages: Array.from({ length: 200 }, (_, i) => message(`$${i}`)),
      },
      history.pages[1],
    ],
  };
  expect(
    applyRoomChanges(current, { added: [message("$new")], updated: [] })
  ).toBeUndefined();
  expect(current.pages[0]?.messages).toHaveLength(200);
  expect(
    applyRoomChanges(current, {
      added: [],
      updated: [{ ...message("$1"), text: "Changed" }],
    })?.pages[0]?.messages[1]?.text
  ).toBe("Changed");
});
