import {
  boolean,
  check,
  jsonb,
  pgTable,
  text,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { z } from "zod";
import type { corpusManifestSchema } from "../../server/creators/corpus/schema";
import { creatorReleases } from "./creator-releases";
export const creatorReleaseCorpora = pgTable(
  "creator_release_corpora",
  {
    releaseId: uuid("release_id")
      .primaryKey()
      .references(() => creatorReleases.id, { onDelete: "cascade" }),
    namespaceId: uuid("namespace_id").unique().notNull(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    manifest: jsonb("manifest")
      .$type<z.infer<typeof corpusManifestSchema>>()
      .notNull(),
    digest: text("digest").notNull(),
    initialized: boolean("initialized").default(false).notNull(),
  },
  (table) => [
    check(
      "creator_release_corpora_manifest_check",
      sql`jsonb_typeof(${table.manifest}) = 'object' AND octet_length(${table.manifest}::text) <= 262144 AND ${table.digest} ~ '^[a-f0-9]{64}$'`
    ),
  ]
);
