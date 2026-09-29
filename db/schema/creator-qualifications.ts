import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  check,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { z } from "zod";
import type { creatorQualificationEvidenceSchema } from "@zoen/companion-ui/creators";
import { creatorReleases } from "./creator-releases";
/** Private grounded qualification; the immutable release remains the sole content owner. */
export const creatorQualifications = pgTable(
  "creator_qualifications",
  {
    id: uuid("id").primaryKey(),
    releaseId: uuid("release_id")
      .notNull()
      .references(() => creatorReleases.id, { onDelete: "cascade" }),
    manifestDigest: text("manifest_digest").notNull(),
    evaluationRevision: uuid("evaluation_revision").notNull(),
    evidence: jsonb("evidence")
      .$type<z.infer<typeof creatorQualificationEvidenceSchema>[]>()
      .notNull(),
    notes: text("notes").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("creator_qualifications_release_idx").on(
      table.releaseId,
      table.createdAt.desc()
    ),
    check(
      "creator_qualifications_payload_check",
      sql`${table.manifestDigest} ~ '^[a-f0-9]{64}$' AND jsonb_typeof(${table.evidence})='array' AND jsonb_array_length(${table.evidence}) BETWEEN 2 AND 20 AND octet_length(${table.evidence}::text)<=2097152 AND length(${table.notes}) BETWEEN 1 AND 8000`
    ),
  ]
);
