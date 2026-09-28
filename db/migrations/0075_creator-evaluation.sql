ALTER TABLE "creator_drafts" ADD COLUMN "evaluation_cases" jsonb;--> statement-breakpoint
ALTER TABLE "creator_drafts" ADD COLUMN "evaluation_revision" uuid;--> statement-breakpoint
ALTER TABLE "creator_drafts" ADD COLUMN "evaluation_updated_at" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "creator_previews" ADD COLUMN "evaluation" jsonb;--> statement-breakpoint
ALTER TABLE "creator_drafts" ADD CONSTRAINT "creator_drafts_evaluation_check" CHECK (
      ("creator_drafts"."evaluation_cases" IS NULL AND "creator_drafts"."evaluation_revision" IS NULL AND "creator_drafts"."evaluation_updated_at" IS NULL)
      OR ("creator_drafts"."evaluation_cases" IS NOT NULL AND "creator_drafts"."evaluation_revision" IS NOT NULL AND "creator_drafts"."evaluation_updated_at" IS NOT NULL
      AND jsonb_typeof("creator_drafts"."evaluation_cases") = 'array' AND jsonb_array_length("creator_drafts"."evaluation_cases") <= 20
      AND octet_length("creator_drafts"."evaluation_cases"::text) <= 1048576));--> statement-breakpoint
ALTER TABLE "creator_previews" ADD CONSTRAINT "creator_previews_evaluation_check" CHECK ("creator_previews"."evaluation" IS NULL OR (
      jsonb_typeof("creator_previews"."evaluation") = 'object' AND octet_length("creator_previews"."evaluation"::text) <= 65536
      AND coalesce("creator_previews"."evaluation"->'case'->>'question' = "creator_previews"."question", false)
      AND coalesce(jsonb_typeof("creator_previews"."evaluation"->'case'->'criteria') = 'string' AND length("creator_previews"."evaluation"->'case'->>'criteria') BETWEEN 1 AND 4000, false)
      AND ("creator_previews"."review" IS NULL OR coalesce("creator_previews"."review"->>'criteria' = "creator_previews"."evaluation"->'case'->>'criteria', false))));