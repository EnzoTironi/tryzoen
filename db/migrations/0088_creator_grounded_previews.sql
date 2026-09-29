ALTER TABLE "creator_previews" DROP CONSTRAINT "creator_previews_kind_check";--> statement-breakpoint
ALTER TABLE "creator_previews" ADD COLUMN "grounding" jsonb;--> statement-breakpoint
ALTER TABLE "creator_previews" ADD COLUMN "grounded_answer" jsonb;--> statement-breakpoint
ALTER TABLE "creator_previews" ADD CONSTRAINT "creator_previews_grounding_check" CHECK (("creator_previews"."kind" = 'grounded-answer') = ("creator_previews"."grounding" IS NOT NULL)
      AND ("creator_previews"."grounding" IS NULL OR (jsonb_typeof("creator_previews"."grounding") = 'object' AND octet_length("creator_previews"."grounding"::text) <= 131072 AND "creator_previews"."evaluation" IS NOT NULL))
      AND ("creator_previews"."grounded_answer" IS NULL OR ("creator_previews"."kind" = 'grounded-answer' AND "creator_previews"."status" = 'completed' AND octet_length("creator_previews"."grounded_answer"::text) <= 65536)));--> statement-breakpoint
ALTER TABLE "creator_previews" ADD CONSTRAINT "creator_previews_kind_check" CHECK ("creator_previews"."kind" IN ('answer', 'playbook', 'grounded-answer') AND ("creator_previews"."kind" IN ('answer', 'grounded-answer') OR "creator_previews"."evaluation" IS NULL));