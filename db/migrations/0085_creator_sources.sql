CREATE TABLE "creator_sources" (
  "id" uuid PRIMARY KEY,
  "workspace_id" text NOT NULL,
  "user_id" text NOT NULL,
  "draft_id" uuid NOT NULL REFERENCES "creator_drafts"("id") ON DELETE CASCADE,
  "revision" uuid DEFAULT gen_random_uuid() NOT NULL,
  "snapshot" jsonb NOT NULL,
  "status" text DEFAULT 'acquired' NOT NULL,
  "rights" text,
  "acquired_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  "reviewed_at" timestamp(3) with time zone,
  "withdrawn_at" timestamp(3) with time zone,
  CONSTRAINT "creator_sources_membership_fk" FOREIGN KEY ("workspace_id", "user_id") REFERENCES "workspace_memberships"("workspace_id", "user_id") ON DELETE CASCADE,
  CONSTRAINT "creator_sources_snapshot_check" CHECK (jsonb_typeof("snapshot") = 'object' AND octet_length("snapshot"::text) <= 131072),
  CONSTRAINT "creator_sources_state_check" CHECK ("status" IN ('acquired','reviewed','withdrawn') AND ("rights" IS NULL OR "rights" IN ('original','permission','public-domain')) AND ("status" != 'reviewed' OR ("rights" IS NOT NULL AND "reviewed_at" IS NOT NULL)) AND ("status" != 'withdrawn' OR "withdrawn_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX "creator_sources_owner_idx" ON "creator_sources" ("workspace_id", "user_id", "draft_id");
