import { query, transaction } from "@db/queries";
import { sql } from "drizzle-orm";
import { expect, test } from "vitest";
import { withSignal } from "../../server/operations/async";
import { workspaceFixture } from "./workspace-fixture";

test("nested transactions roll back to their savepoint and keep the outer transaction usable", async () => {
  await using workspace = await workspaceFixture();
  const id = workspace.actor.userId.slice("better-auth:".length);
  await transaction(async () => {
    await query(sql`UPDATE public.user SET name = 'outer' WHERE id = ${id}`);
    await expect(
      transaction(async () => {
        await query(
          sql`UPDATE public.user SET name = 'inner' WHERE id = ${id}`
        );
        throw new Error("Abort nested write");
      })
    ).rejects.toThrow("Abort nested write");
    expect(
      await query(sql`SELECT name FROM public.user WHERE id = ${id}`)
    ).toEqual([{ name: "outer" }]);
  });
  expect(
    await query(sql`SELECT name FROM public.user WHERE id = ${id}`)
  ).toEqual([{ name: "outer" }]);
});

test("a later failure rolls back earlier writes, including completed nested work", async () => {
  await using workspace = await workspaceFixture();
  const id = workspace.actor.userId.slice("better-auth:".length);
  await expect(
    transaction(async () => {
      await transaction(async () => {
        await query(
          sql`UPDATE public.user SET name = 'discarded' WHERE id = ${id}`
        );
      });
      throw new Error("Abort outer write");
    })
  ).rejects.toThrow("Abort outer write");
  expect(
    await query(sql`SELECT name FROM public.user WHERE id = ${id}`)
  ).toEqual([{ name: "Synthetic owner" }]);
});

test("concurrent request contexts never borrow another request's transaction", async () => {
  await using workspace = await workspaceFixture();
  const id = workspace.actor.userId.slice("better-auth:".length);
  const written = Promise.withResolvers<void>();
  const inspected = Promise.withResolvers<void>();
  const writer = transaction(async () => {
    await query(
      sql`UPDATE public.user SET name = 'private until commit' WHERE id = ${id}`
    );
    written.resolve();
    await inspected.promise;
  });
  try {
    await written.promise;
    expect(
      await query(sql`SELECT name FROM public.user WHERE id = ${id}`)
    ).toEqual([{ name: "Synthetic owner" }]);
  } finally {
    inspected.resolve();
  }
  await writer;
  expect(
    await query(sql`SELECT name FROM public.user WHERE id = ${id}`)
  ).toEqual([{ name: "private until commit" }]);
});

test("aborting an operation prevents its transaction from committing", async () => {
  await using workspace = await workspaceFixture();
  const id = workspace.actor.userId.slice("better-auth:".length);
  const controller = new AbortController();
  const aborted = new Error("Cancelled transaction");
  const settled = Promise.withResolvers<void>();
  await expect(
    withSignal(controller.signal, async () => {
      try {
        await transaction(async () => {
          await query(
            sql`UPDATE public.user SET name = 'cancelled' WHERE id = ${id}`
          );
          controller.abort(aborted);
        });
        return;
      } finally {
        settled.resolve();
      }
    })
  ).rejects.toBe(aborted);
  await settled.promise;
  expect(
    await query(sql`SELECT name FROM public.user WHERE id = ${id}`)
  ).toEqual([{ name: "Synthetic owner" }]);
});
