import { PGlite } from "@electric-sql/pglite";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { resolveMatrixMentions } from "./mentions";
import type { directRoomMembers } from "./direct";

const mocks = vi.hoisted(() => ({
  query: vi.fn<(statement: SQL) => Promise<Record<string, unknown>[]>>(),
  direct: vi.fn<typeof directRoomMembers>(),
}));
vi.mock("@db/queries", () => ({ query: mocks.query }));
vi.mock("./direct", () => ({ directRoomMembers: mocks.direct }));
vi.mock("./client", () => ({
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

beforeAll(async () => {
  await database.exec(`
    CREATE TABLE workspaces(id text PRIMARY KEY, organization_id text);
    CREATE TABLE organization_memberships(organization_id text, user_id text, PRIMARY KEY(organization_id,user_id));
    CREATE TABLE workspace_memberships(workspace_id text,user_id text,PRIMARY KEY(workspace_id,user_id));
    CREATE TABLE workspace_group_bindings(id text PRIMARY KEY,workspace_id text,conversation_id text,channel text,installation_id text,revoked_at timestamptz);
    CREATE TABLE matrix_identities(user_id text PRIMARY KEY,matrix_id text UNIQUE);
    CREATE TABLE matrix_room_members(binding_id text,user_id text,state text,PRIMARY KEY(binding_id,user_id));
    CREATE TABLE user_directory(user_id text PRIMARY KEY,username text UNIQUE);
    CREATE TABLE workspace_agent_members(id uuid PRIMARY KEY,workspace_id text,username text,revoked_at timestamptz);
    INSERT INTO workspaces VALUES ('workspace','org');
    INSERT INTO workspace_group_bindings VALUES ('group','workspace','!group:test','matrix','test',NULL), ('elsewhere','workspace','!other:test','matrix','test',NULL);
    INSERT INTO matrix_identities VALUES ('better-auth:author','@author:test'),('better-auth:alice','@opaque-alice:test'),('better-auth:bob','@opaque-bob:test');
    INSERT INTO user_directory VALUES ('author','author'),('alice','alice'),('bob','bobby');
    INSERT INTO organization_memberships VALUES ('org','better-auth:author'),('org','better-auth:alice'),('org','better-auth:bob');
    INSERT INTO workspace_memberships VALUES ('workspace','better-auth:author'),('workspace','better-auth:alice'),('workspace','better-auth:bob');
  `);
  mocks.query.mockImplementation(async (statement) => {
    const compiled = dialect.sqlToQuery(statement);
    return (
      await database.query<Record<string, unknown>>(
        compiled.sql,
        compiled.params
      )
    ).rows;
  });
}, 20000);
beforeEach(async () => {
  await database.exec(`
    DELETE FROM matrix_room_members;
    INSERT INTO matrix_room_members VALUES ('group','better-auth:author','joined'),('group','better-auth:alice','joined'),('elsewhere','better-auth:bob','joined');
    INSERT INTO organization_memberships VALUES ('org','better-auth:alice') ON CONFLICT DO NOTHING;
    INSERT INTO workspace_memberships VALUES ('workspace','better-auth:alice') ON CONFLICT DO NOTHING;
    UPDATE workspace_group_bindings SET revoked_at=NULL,installation_id='test';
  `);
  mocks.direct.mockReset().mockResolvedValue([
    {
      id: "@author:test",
      username: "author",
      name: "Author",
      mine: true,
      bot: false,
    },
    {
      id: "@opaque-alice:test",
      username: "alice",
      name: "Alice",
      mine: false,
      bot: false,
    },
  ]);
});
afterAll(() => database.close());

it("resolves exact current room identities once and excludes self and other-room members", async () => {
  expect(
    await resolveMatrixMentions(
      actor,
      room,
      "@Alice, @alice and @Zoen; @author @bobby @unknown"
    )
  ).toEqual({ user_ids: ["@bot:test", "@opaque-alice:test"] });
});
it.each([
  "Zoen, help",
  "Discuss Zoen",
  "@zoen_extra",
  "@zoen-extra",
  "mail@zoen.invalid",
  "@zoen:test",
  String.raw`\@zoen`,
  "https://example.invalid/?assignee=@zoen",
  "www.example.invalid/?assignee=@zoen",
  "[docs](https://example.invalid/?assignee=@zoen)",
  "<https://example.invalid/?assignee=@zoen>",
  "![alt @zoen](https://example.invalid)",
  "> @Zoen\n> quoted discussion",
  "    @Zoen",
  "`@Zoen`",
  "`` @Zoen ``",
  "```text\n@Zoen\n```",
  "~~~text\n@Zoen\n~~~",
  "```\n@Zoen",
  '<span title="@Zoen">hello</span>',
  "<code>@Zoen</code>",
  "<pre>@Zoen</pre>",
  "[docs][ref]\n\n[ref]: https://example.invalid/?assignee=@zoen",
])("does not turn referenced text into a mention: %s", async (text) => {
  expect(await resolveMatrixMentions(actor, room, text)).toEqual({
    user_ids: [],
  });
});
it.each([
  "(@Zoen), please",
  "**@Zoen**",
  "[@Zoen](https://example.invalid)",
  "- @Zoen\n- `@alice`",
  "> @alice\n\n@Zoen please",
  "| @Zoen | x |\n| --- | --- |\n| y | z |",
])("recognizes authored prose in Markdown: %s", async (text) => {
  expect(await resolveMatrixMentions(actor, room, text)).toEqual({
    user_ids: ["@bot:test"],
  });
});
it.each(["left", "removed"])("does not mention a %s member", async (state) => {
  await database.query(
    "UPDATE matrix_room_members SET state=$1 WHERE binding_id='group' AND user_id='better-auth:alice'",
    [state]
  );
  expect(await resolveMatrixMentions(actor, room, "@alice")).toEqual({
    user_ids: [],
  });
});
it.each(["workspace_memberships", "organization_memberships"])(
  "respects live %s revocation",
  async (table) => {
    await database.exec(
      `DELETE FROM ${table} WHERE user_id='better-auth:alice'`
    );
    expect(await resolveMatrixMentions(actor, room, "@alice")).toEqual({
      user_ids: [],
    });
  }
);
it("rejects cross-workspace, cross-room, wrong-server and revoked target bindings", async () => {
  for (const target of [{ ...actor, workspaceId: "other" }])
    expect(await resolveMatrixMentions(target, room, "@alice")).toEqual({
      user_ids: [],
    });
  expect(
    await resolveMatrixMentions(
      actor,
      { ...room, roomId: "!wrong:test" },
      "@alice"
    )
  ).toEqual({ user_ids: [] });
  await database.exec(
    "UPDATE workspace_group_bindings SET installation_id='other' WHERE id='group'"
  );
  expect(await resolveMatrixMentions(actor, room, "@alice")).toEqual({
    user_ids: [],
  });
  await database.exec(
    "UPDATE workspace_group_bindings SET installation_id='test', revoked_at=now() WHERE id='group'"
  );
  expect(await resolveMatrixMentions(actor, room, "@alice")).toEqual({
    user_ids: [],
  });
});
it("keeps a direct mention inside its exact pair and never includes the group agent", async () => {
  const direct = { ...room, kind: "direct" as const };
  expect(
    await resolveMatrixMentions(actor, direct, "@alice @bobby @author @Zoen")
  ).toEqual({ user_ids: ["@opaque-alice:test"] });
  expect(mocks.direct).toHaveBeenCalledWith(actor, room.id);
  mocks.direct.mockRejectedValue(new Error("Pair revoked"));
  await expect(resolveMatrixMentions(actor, direct, "@alice")).rejects.toThrow(
    "Pair revoked"
  );
});
