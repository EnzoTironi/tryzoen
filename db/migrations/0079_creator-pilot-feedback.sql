ALTER TABLE "creator_pilots" ADD COLUMN "feedback" text;--> statement-breakpoint
ALTER TABLE "creator_pilots" ADD COLUMN "feedback_revision" uuid;--> statement-breakpoint
ALTER TABLE "creator_pilots" ADD COLUMN "feedback_updated_at" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "creator_pilots" ADD CONSTRAINT "creator_pilots_feedback_check" CHECK (("creator_pilots"."feedback" IS NULL AND "creator_pilots"."feedback_revision" IS NULL AND "creator_pilots"."feedback_updated_at" IS NULL) OR
        ("creator_pilots"."feedback" IS NOT NULL AND length(trim("creator_pilots"."feedback")) BETWEEN 1 AND 16000
        AND "creator_pilots"."feedback_revision" IS NOT NULL AND "creator_pilots"."feedback_updated_at" IS NOT NULL
        AND "creator_pilots"."status" IN ('active', 'withdrawn')));