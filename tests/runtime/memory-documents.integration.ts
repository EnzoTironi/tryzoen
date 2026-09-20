import { Client } from "pg";
import { onTestFinished } from "vitest";

import { env } from "@shared/environment/env";
import { query, transaction as withDatabaseTransaction } from "@db/queries";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import {
  MemoryDocuments,
  MemoryDocumentConflict,
  MemoryDocumentInvalidInput,
  MemoryDocumentStorageError,
} from "../../server/memory/documents";
const fixture = async function (
  body: (
    documents: typeof MemoryDocuments,
    sql: typeof import("drizzle-orm").sql,
    prefix: string
  ) => Promise<void>
) {
  const prefix = `memory-proof/${randomUUID()}/`;
  await (async () => {
    const resource = await Promise.resolve(prefix);
    onTestFinished(async () => {
      await (() =>
        query(
          sql`DELETE FROM memory_document WHERE left(key, char_length(${prefix})) = ${prefix}`
        ))();
    });
    return resource;
  })();
  await body(MemoryDocuments, sql, prefix);
};
const run = (body: Parameters<typeof fixture>[0]) => fixture(body);
test("creates, reads and isolates keys, including an initially empty document", () =>
  run(async (documents, _sql, prefix) => {
    expect(await documents.read(`${prefix}missing`)).toBeNull();
    const first = await documents.write({
      key: `${prefix}a`,
      content: "stable preference",
      expectedVersion: null,
    });
    const other = await documents.write({
      key: `${prefix}b`,
      content: "",
      expectedVersion: null,
    });
    expect(await documents.read(`${prefix}a`)).toEqual(first);
    expect(await documents.read(`${prefix}b`)).toEqual(other);
    expect(first.version).not.toBe(other.version);
    expect(first.content).toBe("stable preference");
    expect(other.content).toBe("");
  }));
test("concurrent create has exactly one winner and never overwrites it", () =>
  run(async (documents, database, prefix) => {
    const key = `${prefix}race-create`;
    const results = await Promise.all(
      Array.from(
        {
          length: 12,
        },
        (_, index) =>
          Promise.try(async () =>
            documents.write({
              key,
              content: `candidate ${String(index)}`,
              expectedVersion: null,
            })
          ).then(
            (value) => ({
              ok: true as const,
              value,
            }),
            (error: unknown) => ({
              ok: false as const,
              error,
            })
          )
      )
    );
    const winners = results.filter((result) => result.ok);
    const conflicts = results.filter((result) => !result.ok);
    expect(winners).toHaveLength(1);
    expect(conflicts).toHaveLength(11);
    expect(
      conflicts.every(
        (result) => result.error instanceof MemoryDocumentConflict
      )
    ).toBe(true);
    expect(await documents.read(key)).toEqual(winners[0]?.value);
    const rows = await query<{
      count: number;
    }>(
      database`SELECT count(*)::int AS count FROM memory_document WHERE key = ${key}`
    );
    expect(rows[0]?.count).toBe(1);
  }));
test("concurrent updates have exactly one winner; stale and missing versions conflict", () =>
  run(async (documents, _sql, prefix) => {
    const key = `${prefix}race-update`;
    const first = await documents.write({
      key,
      content: "original",
      expectedVersion: null,
    });
    const results = await Promise.all(
      Array.from(
        {
          length: 12,
        },
        (_, index) =>
          Promise.try(async () =>
            documents.write({
              key,
              content: `update ${String(index)}`,
              expectedVersion: first.version,
            })
          ).then(
            (value) => ({
              ok: true as const,
              value,
            }),
            (error: unknown) => ({
              ok: false as const,
              error,
            })
          )
      )
    );
    const winners = results.filter((result) => result.ok);
    const conflicts = results.filter((result) => !result.ok);
    expect(winners).toHaveLength(1);
    expect(conflicts).toHaveLength(11);
    expect(
      conflicts.every(
        (result) => result.error instanceof MemoryDocumentConflict
      )
    ).toBe(true);
    const winner = winners[0];
    if (!winner) throw new Error("Missing winner");
    expect(winner.value.version).not.toBe(first.version);
    expect(await documents.read(key)).toEqual(winner.value);
    const stale = await Promise.try(async () =>
      documents.write({
        key,
        content: "must not replace",
        expectedVersion: first.version,
      })
    ).then(
      () => {
        throw new Error("Expected the operation to reject.");
      },
      (error: unknown) => error
    );
    expect(stale).toMatchObject({
      key,
    });
    expect(stale).toBeInstanceOf(MemoryDocumentConflict);
    expect(stale).not.toHaveProperty("content");
    expect(
      await Promise.try(async () =>
        documents.write({
          key: `${prefix}absent`,
          content: "must not create",
          expectedVersion: randomUUID(),
        })
      ).then(
        () => {
          throw new Error("Expected the operation to reject.");
        },
        (error: unknown) => error
      )
    ).toBeInstanceOf(MemoryDocumentConflict);
    expect(await documents.read(`${prefix}absent`)).toBeNull();
    expect(
      await Promise.try(async () =>
        documents.write({
          key,
          content: "create again",
          expectedVersion: null,
        })
      ).then(
        () => {
          throw new Error("Expected the operation to reject.");
        },
        (error: unknown) => error
      )
    ).toBeInstanceOf(MemoryDocumentConflict);
    expect(await documents.read(key)).toEqual(winner.value);
  }));
test("forgetting persists empty content with a new version across a second service connection", () =>
  run(async (documents, database, prefix) => {
    const key = `${prefix}forget`;
    const first = await documents.write({
      key,
      content: "to forget",
      expectedVersion: null,
    });
    const empty = await documents.write({
      key,
      content: "",
      expectedVersion: first.version,
    });
    expect(empty.content).toBe("");
    expect(empty.version).not.toBe(first.version);
    expect(await documents.read(key)).toEqual(empty);
    const client = new Client({
      connectionString: env.DATABASE_URL,
    });
    await client.connect();
    try {
      const rows = await client.query<{
        content: string;
        version: string;
      }>("SELECT content, version FROM memory_document WHERE key = $1", [key]);
      expect(rows.rows[0]).toEqual(empty);
    } finally {
      await client.end();
    }
  }));
test("invalid key, oversized content and invalid expected version are typed failures", () =>
  run(async (documents, database, prefix) => {
    const valid = {
      key: `${prefix}invalid`,
      content: "bounded",
      expectedVersion: null,
    };
    const invalid = [
      {
        ...valid,
        key: "",
      },
      {
        ...valid,
        key: " padded ",
      },
      {
        ...valid,
        key: "x".repeat(513),
      },
      {
        ...valid,
        content: "x".repeat(4001),
      },
      {
        ...valid,
        expectedVersion: "not-a-uuid",
      },
    ];
    const errors = await Promise.all(
      invalid.map((input) =>
        Promise.try(async () => documents.write(input)).then(
          () => {
            throw new Error("Expected the operation to reject.");
          },
          (error: unknown) => error
        )
      )
    );
    expect(
      errors.every((error) => error instanceof MemoryDocumentInvalidInput)
    ).toBe(true);
    expect(
      await Promise.try(async () => documents.read(" ")).then(
        () => {
          throw new Error("Expected the operation to reject.");
        },
        (error: unknown) => error
      )
    ).toBeInstanceOf(MemoryDocumentInvalidInput);
    const rows = await query(
      database`SELECT key FROM memory_document WHERE key = ${valid.key}`
    );
    expect(rows).toHaveLength(0);
    const boundary = await documents.write({
      key: `${prefix}${"x".repeat(512 - prefix.length)}`,
      content: "x".repeat(4000),
      expectedVersion: null,
    });
    expect(boundary.content).toHaveLength(4000);
  }));
test("real SQL failures stay typed and never become missing documents", () =>
  run((documents, database, prefix) =>
    withDatabaseTransaction(async () => {
      // Hide public tables only for this real transaction; no schema or permissions change.
      await query(database`SET LOCAL search_path TO pg_catalog`);
      const error = await Promise.try(async () =>
        documents.read(`${prefix}unavailable`)
      ).then(
        () => {
          throw new Error("Expected the operation to reject.");
        },
        (cause: unknown) => cause
      );
      expect(error).toBeInstanceOf(MemoryDocumentStorageError);
      expect(error).not.toHaveProperty("cause");
      expect(error).not.toHaveProperty("content");
    })
  ));
