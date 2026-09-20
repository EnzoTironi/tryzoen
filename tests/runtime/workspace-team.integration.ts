import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { expect, test } from "vitest";

import { WorkspaceAccessDenied } from "../../server/workspaces/access";
import {
  readDirectoryProfile,
  saveDirectoryProfile,
  searchDirectory,
} from "../../server/accounts/directory";
import {
  answerWorkspaceInvitation,
  inviteWorkspaceMember,
  readWorkspaceInvitations,
  readWorkspaceTeam,
  removeWorkspaceMember,
  revokeWorkspaceInvitation,
} from "../../server/workspaces/team";
import { workspaceFixture } from "./workspace-fixture";

const run = async (
  body: (fixture: Awaited<ReturnType<typeof workspaceFixture>>) => Promise<void>
) => {
  await using workspace = await workspaceFixture();
  await body(workspace);
};

test("usernames are unique, reserved names are rejected and search respects opt-in", () =>
  run(async ({ actor, guest }) => {
    const username = `u${randomUUID().replaceAll("-", "").slice(0, 20)}`;
    await saveDirectoryProfile(actor, { username, discoverable: false });
    expect((await readDirectoryProfile(actor))?.username).toBe(username);
    expect(await searchDirectory(guest, username)).toEqual([]);
    const collision = await Promise.try(async () =>
      saveDirectoryProfile(guest, {
        username,
        discoverable: true,
      })
    ).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error })
    );
    expect(!collision.ok).toBe(true);
    await saveDirectoryProfile(actor, { username, discoverable: true });
    expect(await searchDirectory(guest, username)).toEqual([{ username }]);
    expect(await searchDirectory(guest, "%")).toEqual([]);
    const reserved = await Promise.try(async () =>
      saveDirectoryProfile(guest, {
        username: "admin",
        discoverable: true,
      })
    ).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error })
    );
    expect(!reserved.ok && reserved.error).toMatchObject({
      reason: "reserved",
    });
  }));

test("a named invitation grants no access until its recipient accepts; removal revokes files immediately", () =>
  run(async ({ actor, guest, guestPersonal, repository }) => {
    const username = `u${randomUUID().replaceAll("-", "").slice(0, 20)}`;
    await saveDirectoryProfile(guestPersonal, {
      username,
      discoverable: false,
    });
    await query(
      sql`DELETE FROM workspace_memberships WHERE workspace_id = ${actor.workspaceId} AND user_id = ${guest.userId}`
    );
    await repository.write(actor, {
      operationId: randomUUID(),
      path: "knowledge/team.md",
      content: "Shared only after joining",
      expectedRevision: null,
    });
    const invitation = await inviteWorkspaceMember(actor, username);
    expect((await readWorkspaceInvitations(guestPersonal))[0]?.id).toBe(
      invitation.id
    );
    expect((await readWorkspaceTeam(actor)).invites).toHaveLength(1);
    const unauthorized = await Promise.try(async () =>
      repository.read(guest)
    ).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error })
    );
    expect(!unauthorized.ok && unauthorized.error).toBeInstanceOf(
      WorkspaceAccessDenied
    );
    const invitationId = invitation.id;
    if (!invitationId) throw new Error("Invitation ID missing");
    const theft = await Promise.try(async () =>
      answerWorkspaceInvitation(actor, invitationId, true)
    ).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error })
    );
    expect(!theft.ok && theft.error).toBeInstanceOf(WorkspaceAccessDenied);
    await answerWorkspaceInvitation(guestPersonal, invitationId, true);
    expect((await repository.read(guest)).files).toEqual(["knowledge/team.md"]);
    const escalation = await Promise.try(async () =>
      inviteWorkspaceMember(guest, username)
    ).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error })
    );
    expect(!escalation.ok && escalation.error).toBeInstanceOf(
      WorkspaceAccessDenied
    );
    const selfRemoval = await Promise.try(async () =>
      removeWorkspaceMember(actor, actor.userId)
    ).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error })
    );
    expect(!selfRemoval.ok).toBe(true);
    await removeWorkspaceMember(actor, guest.userId);
    const removed = await Promise.try(async () =>
      repository.export(guest)
    ).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error })
    );
    expect(!removed.ok && removed.error).toBeInstanceOf(WorkspaceAccessDenied);
    expect(await readWorkspaceInvitations(guestPersonal)).toEqual([]);
  }));

test("revoked or expired invitations cannot be accepted", () =>
  run(async ({ actor, guest, guestPersonal }) => {
    const username = `u${randomUUID().replaceAll("-", "").slice(0, 20)}`;
    await saveDirectoryProfile(guestPersonal, {
      username,
      discoverable: false,
    });
    await query(
      sql`DELETE FROM workspace_memberships WHERE workspace_id = ${actor.workspaceId} AND user_id = ${guest.userId}`
    );
    const first = await inviteWorkspaceMember(actor, username);
    const firstId = first.id;
    if (!firstId) throw new Error("Invitation ID missing");
    await revokeWorkspaceInvitation(actor, firstId);
    expect(
      !(
        await Promise.try(async () =>
          answerWorkspaceInvitation(guestPersonal, firstId, true)
        ).then(
          (value) => ({ ok: true as const, value }),
          (error: unknown) => ({ ok: false as const, error })
        )
      ).ok
    ).toBe(true);
    const second = await inviteWorkspaceMember(actor, username);
    const secondId = second.id;
    if (!secondId) throw new Error("Invitation ID missing");
    await query(
      sql`UPDATE workspace_invites SET expires_at = now() - interval '1 minute' WHERE id = ${secondId}`
    );
    expect(
      !(
        await Promise.try(async () =>
          answerWorkspaceInvitation(guestPersonal, secondId, true)
        ).then(
          (value) => ({ ok: true as const, value }),
          (error: unknown) => ({ ok: false as const, error })
        )
      ).ok
    ).toBe(true);
  }));
