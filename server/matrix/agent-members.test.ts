import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createAgentMemberTable } from "../../tests/helpers/agent-members";
import { readRoomMembers } from "./members";
import { resolveMatrixMentions } from "./mentions";
import { projectMatrixMessage } from "./messages";
import { MatrixEventSchema } from "./client";
import type { directRoomMembers } from "./direct";

const mocks = vi.hoisted(() => ({
  query: vi.fn<(statement: SQL) => Promise<Record<string, unknown>[]>>(),
  direct: vi.fn<typeof directRoomMembers>(),
}));
vi.mock("@db/queries", () => ({ query: mocks.query }));
vi.mock("./direct", () => ({ directRoomMembers: mocks.direct }));
vi.mock("./client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./client")>()),
  matrixConfiguration: async () => ({ serverName: "test", botId: "@bot:test" }),
}));
const database = new PGlite();
const dialect = new PgDialect();
const actor = {
  userId: "better-auth:author",
  workspaceId: "workspace",
  authSessionId: "session",
};
const room = {
  id: "group",
  workspaceId: "workspace",
  roomId: "!group:test",
  label: "Synthetic",
  epoch: "epoch",
  kind: "group" as const,
  matrixId: "@author:test",
};
let memberId: string;
let matrixId: string;
const mapped = async (binding = "group", state = "joined") => {
  await database.query(
    "INSERT INTO matrix_identities VALUES ($1,$2) ON CONFLICT DO NOTHING",
    [`agent:${memberId}`, matrixId]
  );
  await database.query("INSERT INTO matrix_room_members VALUES ($1,$2,$3)", [
    binding,
    `agent:${memberId}`,
    state,
  ]);
};
beforeAll(async () => {
  await database.exec(`
    CREATE TABLE workspaces(id text PRIMARY KEY,organization_id text);
    CREATE TABLE public.user(id text PRIMARY KEY,name text,image text);
    CREATE TABLE workspace_memberships(workspace_id text,user_id text,role text,PRIMARY KEY(workspace_id,user_id));
    CREATE TABLE organization_memberships(organization_id text,user_id text,PRIMARY KEY(organization_id,user_id));
    CREATE TABLE user_directory(user_id text PRIMARY KEY,username text UNIQUE);
    CREATE TABLE workspace_group_bindings(id text PRIMARY KEY,workspace_id text,conversation_id text,channel text,installation_id text,revoked_at timestamptz);
    CREATE TABLE matrix_identities(user_id text PRIMARY KEY,matrix_id text UNIQUE);
    CREATE TABLE matrix_room_members(binding_id text,user_id text,state text,PRIMARY KEY(binding_id,user_id));
    INSERT INTO workspaces VALUES ('workspace','org'),('other','other-org');
  `);
  await createAgentMemberTable(database);
}, 20000);
beforeEach(async () => {
  await database.exec(`
    TRUNCATE workspace_agent_members,public.user,workspace_memberships,organization_memberships,user_directory,workspace_group_bindings,matrix_identities,matrix_room_members;
    INSERT INTO public.user VALUES ('author','Author',NULL),('alice','Alice',NULL);
    INSERT INTO workspace_memberships VALUES ('workspace','better-auth:author','admin'),('workspace','better-auth:alice','member');
    INSERT INTO organization_memberships VALUES ('org','better-auth:author'),('org','better-auth:alice');
    INSERT INTO user_directory VALUES ('author','author'),('alice','alice');
    INSERT INTO workspace_group_bindings VALUES ('group','workspace','!group:test','matrix','test',NULL),('elsewhere','workspace','!elsewhere:test','matrix','test',NULL);
    INSERT INTO matrix_identities VALUES ('better-auth:author','@author:test'),('better-auth:alice','@alice:test');
    INSERT INTO matrix_room_members VALUES ('group','better-auth:author','joined'),('group','better-auth:alice','joined');
  `);
  const result = await database.query<{ id: string }>(
    "INSERT INTO workspace_agent_members(workspace_id,username,name,created_by,registration_operation_id,registration_request_hash) VALUES ('workspace','helper','External helper','better-auth:author',$1,repeat('a',64)) RETURNING id",
    [randomUUID()]
  );
  memberId = result.rows[0]?.id ?? "";
  matrixId = `@_zoen_agent_${memberId.replaceAll("-", "")}:test`;
  mocks.query.mockReset().mockImplementation(async (statement) => {
    const compiled = dialect.sqlToQuery(statement);
    return (
      await database.query<Record<string, unknown>>(
        compiled.sql,
        compiled.params
      )
    ).rows;
  });
  mocks.direct.mockReset().mockResolvedValue([
    {
      id: "@author:test",
      name: "Author",
      username: "author",
      mine: true,
      bot: false,
    },
    {
      id: "@alice:test",
      name: "Alice",
      username: "alice",
      mine: false,
      bot: false,
    },
  ]);
});
afterAll(() => database.close());

it("does not treat directory registration as native room participation", async () => {
  expect(await readRoomMembers(actor, room.id, room.kind)).toHaveLength(2);
  expect(await resolveMatrixMentions(actor, room, "@helper")).toEqual({
    user_ids: [],
  });
  await database.query("INSERT INTO matrix_identities VALUES ($1,$2)", [
    `agent:${memberId}`,
    matrixId,
  ]);
  expect(await resolveMatrixMentions(actor, room, "@helper")).toEqual({
    user_ids: [],
  });
});
it("projects only the exact joined principal and attributes its native messages", async () => {
  await mapped();
  const people = await readRoomMembers(actor, room.id, room.kind);
  expect(people.find((person) => person.id === matrixId)).toEqual({
    id: matrixId,
    name: "External helper",
    username: "helper",
    mine: false,
    bot: true,
    mayRemove: false,
    avatarUri: null,
  });
  expect(people.find((person) => person.id === "@alice:test")?.bot).toBe(false);
  expect(
    await resolveMatrixMentions(
      actor,
      room,
      "@Helper, @helper, @alice and @Zoen"
    )
  ).toEqual({ user_ids: [matrixId, "@alice:test", "@bot:test"].toSorted() });
  const message = MatrixEventSchema.parse({
    event_id: "$message",
    room_id: room.roomId,
    type: "m.room.message",
    sender: matrixId,
    content: {
      msgtype: "m.text",
      body: "Result",
      "m.relates_to": { rel_type: "m.thread", event_id: "$root" },
    },
    origin_server_ts: 1,
  });
  expect(
    projectMatrixMessage(message, people, room.matrixId, "@bot:test")
  ).toMatchObject({
    id: "$message",
    senderId: matrixId,
    sender: "External helper",
    bot: true,
    mine: false,
    rootId: "$root",
    timestamp: 1,
  });
  expect(
    projectMatrixMessage(message, [], room.matrixId, "@bot:test")
  ).toMatchObject({ sender: matrixId, bot: false });
});
it.each(["left", "removed"])(
  "excludes a %s member from roster and mentions",
  async (state) => {
    await mapped("group", state);
    expect(
      (await readRoomMembers(actor, room.id, room.kind)).some(
        (person) => person.id === matrixId
      )
    ).toBe(false);
    expect(await resolveMatrixMentions(actor, room, "@helper")).toEqual({
      user_ids: [],
    });
  }
);
it.each([
  "revoked",
  "different workspace",
  "different room",
  "revoked binding",
])("excludes %s identities without changing human mentions", async (reason) => {
  await mapped(reason === "different room" ? "elsewhere" : "group");
  if (reason === "revoked")
    await database.query(
      "UPDATE workspace_agent_members SET revoked_at=now() WHERE id=$1",
      [memberId]
    );
  if (reason === "different workspace")
    await database.query(
      "UPDATE workspace_agent_members SET workspace_id='other' WHERE id=$1",
      [memberId]
    );
  if (reason === "revoked binding")
    await database.exec(
      "UPDATE workspace_group_bindings SET revoked_at=now() WHERE id='group'"
    );
  expect(
    (await readRoomMembers(actor, room.id, room.kind)).some(
      (person) => person.id === matrixId
    )
  ).toBe(false);
  const mentions = await resolveMatrixMentions(actor, room, "@helper @alice");
  expect(mentions.user_ids).toEqual(
    reason === "revoked binding" ? [] : ["@alice:test"]
  );
});
it("fails closed on wrong native room/server and cross-workspace targets", async () => {
  await mapped();
  expect(
    await resolveMatrixMentions(
      actor,
      { ...room, roomId: "!wrong:test" },
      "@helper"
    )
  ).toEqual({ user_ids: [] });
  expect(
    await resolveMatrixMentions(
      { ...actor, workspaceId: "other" },
      room,
      "@helper"
    )
  ).toEqual({ user_ids: [] });
  await database.exec(
    "UPDATE workspace_group_bindings SET installation_id='other' WHERE id='group'"
  );
  expect(await resolveMatrixMentions(actor, room, "@helper")).toEqual({
    user_ids: [],
  });
});
it.each(["alice", "author"])(
  "does not notify either identity for an ambiguous @%s",
  async (username) => {
    await mapped();
    await database.query(
      "UPDATE workspace_agent_members SET username=$1 WHERE id=$2",
      [username, memberId]
    );
    expect(
      await resolveMatrixMentions(actor, room, `@${username} @Zoen`)
    ).toEqual({ user_ids: ["@bot:test"] });
  }
);
it.each([
  "> @helper",
  "`@helper`",
  "https://example.invalid/?assignee=@helper",
  "[docs](https://example.invalid/?assignee=@helper)",
  String.raw`\@helper`,
])(
  "preserves native mention exclusions for external agents: %s",
  async (text) => {
    await mapped();
    expect(await resolveMatrixMentions(actor, room, text)).toEqual({
      user_ids: [],
    });
  }
);
it("keeps direct messages restricted to the existing pair", async () => {
  await mapped();
  expect(
    await resolveMatrixMentions(
      actor,
      { ...room, kind: "direct" },
      "@helper @alice"
    )
  ).toEqual({ user_ids: ["@alice:test"] });
  expect(await readRoomMembers(actor, room.id, "direct")).toEqual(
    await mocks.direct(actor, room.id)
  );
});
it("preserves native edits, replies and redaction while deriving bot attribution from the roster", async () => {
  await mapped();
  const people = await readRoomMembers(actor, room.id, room.kind);
  const original = {
    event_id: "$message",
    room_id: room.roomId,
    type: "m.room.message",
    sender: matrixId,
    origin_server_ts: 1,
    content: {
      msgtype: "m.text",
      body: "> <@alice:test> Earlier\n\nBefore",
      "m.relates_to": { "m.in_reply_to": { event_id: "$quoted" } },
    },
    unsigned: {
      "m.relations": {
        "m.replace": {
          event_id: "$edit",
          room_id: room.roomId,
          type: "m.room.message",
          sender: matrixId,
          origin_server_ts: 2,
          content: {
            msgtype: "m.text",
            body: "* After",
            "m.new_content": { msgtype: "m.text", body: "After" },
            "m.relates_to": { rel_type: "m.replace", event_id: "$message" },
          },
        },
      },
    },
  };
  const message = projectMatrixMessage(
    MatrixEventSchema.parse(original),
    people,
    room.matrixId,
    "@bot:test"
  );
  expect(message).toMatchObject({
    id: "$message",
    senderId: matrixId,
    bot: true,
    text: "After",
    timestamp: 1,
    editId: "$edit",
    reply: { id: "$quoted", sender: "Alice", text: "Earlier" },
  });
  expect(
    projectMatrixMessage(
      MatrixEventSchema.parse({
        ...original,
        unsigned: {
          ...original.unsigned,
          redacted_because: { event_id: "$redaction" },
        },
      }),
      people,
      room.matrixId,
      "@bot:test"
    )
  ).toMatchObject({
    id: "$message",
    senderId: matrixId,
    bot: true,
    text: "Mensagem removida",
    redacted: true,
    reply: null,
  });
});
