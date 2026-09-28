ALTER TABLE "creator_previews" ADD COLUMN "models" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "creator_previews" ADD COLUMN "started_at" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "creator_previews" ADD COLUMN "finished_at" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "creator_previews" ADD CONSTRAINT "creator_previews_execution_check" CHECK (jsonb_typeof("creator_previews"."models") = 'array' AND jsonb_array_length("creator_previews"."models") <= 8
        AND octet_length("creator_previews"."models"::text) <= 16384
        AND ("creator_previews"."finished_at" IS NULL OR ("creator_previews"."started_at" IS NOT NULL AND "creator_previews"."finished_at" >= "creator_previews"."started_at")));