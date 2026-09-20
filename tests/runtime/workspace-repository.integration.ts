import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { expect, test } from "vitest";
import { workspaceFixture as fixture } from "./workspace-fixture";
import { WorkspaceAccessDenied } from "../../server/workspaces/access";

const run = async (
  body: (value: Awaited<ReturnType<typeof fixture>>) => Promise<void>
) => {
  await body(await fixture());
};

test("isolates personal and team repositories, preserves history and rejects forged revisions", () =>
  run(async ({ actor, guest, personal, repository }) => {
    const personalWrite = await repository.write(personal, {
      operationId: randomUUID(),
      expectedRevision: null,
      path: "knowledge/private.md",
      content: "PERSONAL ONLY",
    });
    const write = {
      operationId: randomUUID(),
      expectedRevision: null,
      path: "knowledge/plan.md",
      content: "Team plan",
    };
    const first = await repository.write(actor, write);
    expect(await repository.write(actor, write)).toEqual(first);
    expect((await repository.read(guest)).files).toEqual(["knowledge/plan.md"]);
    expect((await repository.read(personal)).files).toEqual([
      "knowledge/private.md",
    ]);
    const foreign = await Promise.try(async () =>
      repository.read(guest, "knowledge/private.md", personalWrite.revision)
    ).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error })
    );
    expect(!foreign.ok && foreign.error).toMatchObject({
      reason: "not_found",
    });
    const update = await repository.write(guest, {
      operationId: randomUUID(),
      expectedRevision: first.revision,
      path: "knowledge/plan.md",
      content: "Guest contribution",
    });
    expect(update.revision).not.toBe(first.revision);
    expect(
      (await repository.read(actor, "knowledge/plan.md", first.revision))
        .content
    ).toBe("Team plan");
    expect(await repository.history(guest, "knowledge/plan.md")).toHaveLength(
      2
    );
    expect((await repository.export(actor))?.bundle.length).toBeGreaterThan(
      100
    );
    const changedReplay = await Promise.try(async () =>
      repository.write(actor, { ...write, content: "Altered retry" })
    ).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error })
    );
    expect(!changedReplay.ok && changedReplay.error).toMatchObject({
      reason: "conflict",
    });
  }));

test("two simultaneous edits have one publication winner and never overwrite each other", () =>
  run(async ({ actor, repository }) => {
    const results = await Promise.all(
      ["One", "Two", "Three", "Four"].map((content) =>
        Promise.try(async () =>
          repository.write(actor, {
            operationId: randomUUID(),
            expectedRevision: null,
            path: "knowledge/plan.md",
            content,
          })
        ).then(
          (value) => ({ ok: true as const, value }),
          (error: unknown) => ({ ok: false as const, error })
        )
      )
    );
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    const failures = results.filter((result) => !result.ok);
    expect(failures).toHaveLength(3);
    expect(failures.map((result) => result.error)).toEqual([
      expect.objectContaining({ reason: "conflict" }),
      expect.objectContaining({ reason: "conflict" }),
      expect.objectContaining({ reason: "conflict" }),
    ]);
    expect(await repository.history(actor, "knowledge/plan.md")).toHaveLength(
      1
    );
  }));

test("members cannot alter agent instructions; removal blocks current files, history and export", () =>
  run(async ({ actor, guest, repository }) => {
    const first = await repository.write(actor, {
      operationId: randomUUID(),
      expectedRevision: null,
      path: "agent/SOUL.md",
      content: "Be helpful.",
    });
    const denied = await Promise.try(async () =>
      repository.write(guest, {
        operationId: randomUUID(),
        expectedRevision: first.revision,
        path: "agent/SOUL.md",
        content: "Override",
      })
    ).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error })
    );
    expect(!denied.ok && denied.error).toBeInstanceOf(WorkspaceAccessDenied);
    await query(
      sql`DELETE FROM workspace_memberships WHERE workspace_id = ${actor.workspaceId} AND user_id = ${guest.userId}`
    );
    await Promise.all(
      [
        repository.read(guest),
        repository.history(guest, "agent/SOUL.md"),
        repository.export(guest),
      ].map((operation) =>
        expect(operation).rejects.toBeInstanceOf(WorkspaceAccessDenied)
      )
    );
    await query(
      sql`DELETE FROM public.session WHERE id = ${actor.authSessionId}`
    );
    const signedOut = await Promise.try(async () =>
      repository.read(actor)
    ).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error })
    );
    expect(!signedOut.ok && signedOut.error).toBeInstanceOf(
      WorkspaceAccessDenied
    );
  }));
