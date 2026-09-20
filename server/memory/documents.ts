import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import { SqlError } from "../../db/queries";
import { z } from "zod";
import { randomUUID } from "node:crypto";
const keySchema = z
  .string()
  .min(1)
  .max(512)
  .refine((value) => value === value.trim(), "Expected trimmed text");
const contentSchema = z.string().max(4000);
const versionSchema = z.uuid();
const MemoryDocumentSchema = z.object({
  content: contentSchema,
  version: versionSchema,
});
const writeInput = z.object({
  key: keySchema,
  content: contentSchema,
  expectedVersion: z.nullable(versionSchema),
});
export class MemoryDocumentConflict extends Error {
  readonly _tag = "MemoryDocumentConflict";
  declare readonly key: z.output<typeof keySchema>;
  constructor(input: { readonly key: z.output<typeof keySchema> }) {
    super("MemoryDocumentConflict");
    this.name = "MemoryDocumentConflict";
    Object.assign(this, input);
  }
}
export class MemoryDocumentInvalidInput extends Error {
  readonly _tag = "MemoryDocumentInvalidInput";
  constructor() {
    super("MemoryDocumentInvalidInput");
    this.name = "MemoryDocumentInvalidInput";
  }
}
export class MemoryDocumentStorageError extends Error {
  readonly _tag = "MemoryDocumentStorageError";
  constructor() {
    super("MemoryDocumentStorageError");
    this.name = "MemoryDocumentStorageError";
  }
}
const invalidInput = () => new MemoryDocumentInvalidInput();
function storageError(): never {
  throw new MemoryDocumentStorageError();
}
export const MemoryDocuments = {
  read: async function (key: string) {
    try {
      const valid = await Promise.try(async () =>
        keySchema.parseAsync(key)
      ).catch(() => {
        throw invalidInput();
      });
      const rows = await query(
        sql`SELECT content, version FROM memory_document WHERE key = ${valid}`
      );
      if (!rows[0]) return null;
      try {
        return await MemoryDocumentSchema.parseAsync(rows[0]);
      } catch {
        return storageError();
      }
    } catch (error) {
      if (error instanceof SqlError) {
        return storageError();
      }
      throw error;
    }
  },
  write: async function (input: z.output<typeof writeInput>) {
    try {
      const value = await Promise.try(async () =>
        writeInput.strict().parseAsync(input)
      ).catch(() => {
        throw invalidInput();
      });
      const version = randomUUID();
      const rows =
        value.expectedVersion === null
          ? await query(sql`INSERT INTO memory_document (key, content, version)
            VALUES (${value.key}, ${value.content}, ${version})
            ON CONFLICT (key) DO NOTHING RETURNING content, version`)
          : await query(sql`UPDATE memory_document SET content = ${value.content}, version = ${version}, updated_at = clock_timestamp()
            WHERE key = ${value.key} AND version = ${value.expectedVersion}
            RETURNING content, version`);
      if (!rows[0])
        throw new MemoryDocumentConflict({
          key: value.key,
        });
      try {
        return await MemoryDocumentSchema.parseAsync(rows[0]);
      } catch {
        return storageError();
      }
    } catch (error) {
      if (error instanceof SqlError) {
        return storageError();
      }
      throw error;
    }
  },
};
