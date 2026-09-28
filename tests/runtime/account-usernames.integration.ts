import { WorkspaceAccessDenied } from "../../server/workspaces/access";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { expect, test } from "vitest";
import { query, SqlError } from "@db/queries";
import { workspaceFixture } from "./workspace-fixture";
import {
  saveDirectoryProfile,
  searchDirectory,
} from "../../server/accounts/directory";
import {
  saveCreatorDraft,
  readCreatorDraft,
} from "../../server/creators/drafts";
import { claimCreatorUsername } from "../../server/creators/identity";

test("people and bots share unique usernames; registered ownership determines type without a suffix", async () => {
  await using workspace = await workspaceFixture();
  const { actor, guest } = workspace;
  const username = `coach_${randomUUID().slice(0, 8)}`;
  const draft = await saveCreatorDraft(actor, {
    id: randomUUID(),
    expectedRevision: null,
    content: {
      title: "Synthetic coach",
      description: "",
      playbook: "",
      examples: [],
    },
  });
  const claim = { id: draft.id, username, expectedUsername: null };
  const results = await Promise.allSettled([
    claimCreatorUsername(actor, claim),
    saveDirectoryProfile(guest, { username, discoverable: true }),
  ]);
  expect(
    results.filter((result) => result.status === "fulfilled")
  ).toHaveLength(1);
  const [owner] = await query<{ kind: string }>(
    sql`SELECT kind FROM user_directory WHERE username = ${username}`
  );
  expect(results.find((result) => result.status === "rejected")).toMatchObject({
    reason: { reason: "unavailable" },
  });
  if (owner?.kind === "person") {
    await saveDirectoryProfile(guest, {
      username: `${username}_person`,
      discoverable: true,
    });
  }
  await expect(claimCreatorUsername(actor, claim)).resolves.toEqual({
    username,
    kind: "bot",
  });
  await expect(claimCreatorUsername(actor, claim)).resolves.toEqual({
    username,
    kind: "bot",
  });
  expect((await readCreatorDraft(actor, draft.id)).username).toBe(username);
  await expect(
    saveDirectoryProfile(guest, { username, discoverable: false })
  ).rejects.toMatchObject({ reason: "unavailable" });
  await expect(
    claimCreatorUsername(guest, {
      ...claim,
      username: `${username}_stolen`,
      expectedUsername: username,
    })
  ).rejects.toThrow(WorkspaceAccessDenied);
  await expect(
    claimCreatorUsername(actor, { ...claim, username: "zoen" })
  ).rejects.toMatchObject({ reason: "reserved" });
  await expect(
    claimCreatorUsername(actor, { ...claim, username: `${username}_new` })
  ).rejects.toThrow("changed elsewhere");
  await expect(
    query(
      sql`UPDATE user_directory SET kind = 'person' WHERE username = ${username}`
    )
  ).rejects.toThrow(SqlError);
  await expect(
    query(
      sql`UPDATE user_directory SET user_id = ${guest.userId.replace("better-auth:", "")} WHERE username = ${username}`
    )
  ).rejects.toThrow(SqlError);
  expect(
    (await searchDirectory(actor, username)).some(
      (entry) => entry.username === username
    )
  ).toBe(false);
  const person = `${username}_bot`;
  await saveDirectoryProfile(guest, { username: person, discoverable: true });
  expect(
    await query(sql`SELECT kind FROM user_directory WHERE username = ${person}`)
  ).toEqual([{ kind: "person" }]);
  expect(
    await query(sql`SELECT kind FROM user_directory WHERE username = 'zoen'`)
  ).toEqual([{ kind: "bot" }]);
});
