import { query, transaction } from "@db/queries";
import { sql } from "drizzle-orm";
import type { z } from "zod";
import { personalNoteUpdateSchema } from "@shared/personal-memory/schema";
import { replacePersonalNoteText } from "@shared/personal-memory/document";
import { MemoryDocuments } from "../memory/documents";
import { requirePersonalMemorySession } from "./export";

export class PersonalNoteChanged extends Error {
  constructor() {
    super("This note changed. Reload it before saving again.");
  }
}

export async function updatePersonalNote(
  headers: Headers,
  raw: z.output<typeof personalNoteUpdateSchema>
) {
  const input = personalNoteUpdateSchema.parse(raw);
  return transaction(async () => {
    // Keep the exact live session and membership locked through the write.
    const scope = await requirePersonalMemorySession(headers);
    const matches = await query<{ key: string; content: string }>(sql`
      SELECT d.key, d.content FROM personal_memory_binding b
      INNER JOIN memory_document d ON d.key = b.key
      WHERE b.workspace_id = ${scope.workspaceId} AND b.slot = 'profile'
        AND d.version = ${input.expectedVersion}
      FOR UPDATE OF d FOR SHARE OF b`);
    if (matches.length !== 1 || !matches[0]) throw new PersonalNoteChanged();
    return MemoryDocuments.write({
      key: matches[0].key,
      expectedVersion: input.expectedVersion,
      content: replacePersonalNoteText(matches[0].content, input.content),
    });
  });
}
