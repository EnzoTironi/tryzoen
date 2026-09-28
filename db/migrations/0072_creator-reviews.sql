ALTER TABLE "creator_previews" ADD COLUMN "review" jsonb;--> statement-breakpoint
ALTER TABLE "creator_previews" ADD COLUMN "review_revision" uuid;--> statement-breakpoint
ALTER TABLE "creator_previews" ADD COLUMN "reviewed_at" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "creator_previews" ADD CONSTRAINT "creator_previews_review_check" CHECK (("creator_previews"."review" IS NULL AND "creator_previews"."review_revision" IS NULL AND "creator_previews"."reviewed_at" IS NULL)
        OR ("creator_previews"."review" IS NOT NULL AND "creator_previews"."review_revision" IS NOT NULL AND "creator_previews"."reviewed_at" IS NOT NULL
        AND "creator_previews"."status" = 'completed' AND jsonb_typeof("creator_previews"."review") = 'object'
        AND octet_length("creator_previews"."review"::text) <= 65536
        AND coalesce(jsonb_typeof("creator_previews"."review"->'criteria') = 'string' AND length("creator_previews"."review"->>'criteria') BETWEEN 1 AND 4000, false)
        AND coalesce(jsonb_typeof("creator_previews"."review"->'notes') = 'string' AND length("creator_previews"."review"->>'notes') BETWEEN 1 AND 8000, false)
        AND coalesce("creator_previews"."review"->>'verdict' IN ('useful', 'needs-revision', 'unsafe-or-unsupported'), false)));