CREATE TABLE "creator_qualifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"release_id" uuid NOT NULL,
	"manifest_digest" text NOT NULL,
	"evaluation_revision" uuid NOT NULL,
	"evidence" jsonb NOT NULL,
	"notes" text NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creator_qualifications_payload_check" CHECK ("creator_qualifications"."manifest_digest" ~ '^[a-f0-9]{64}$' AND jsonb_typeof("creator_qualifications"."evidence")='array' AND jsonb_array_length("creator_qualifications"."evidence") BETWEEN 2 AND 20 AND octet_length("creator_qualifications"."evidence"::text)<=2097152 AND length("creator_qualifications"."notes") BETWEEN 1 AND 8000)
);
--> statement-breakpoint
ALTER TABLE "creator_previews" DROP CONSTRAINT "creator_previews_pilot_check";--> statement-breakpoint
ALTER TABLE "creator_previews" DROP CONSTRAINT "creator_previews_grounding_check";--> statement-breakpoint
ALTER TABLE "creator_pilots" ADD COLUMN "qualification_id" uuid;--> statement-breakpoint
ALTER TABLE "creator_qualifications" ADD CONSTRAINT "creator_qualifications_release_id_creator_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."creator_releases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "creator_qualifications_release_idx" ON "creator_qualifications" USING btree ("release_id","created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "creator_pilots" ADD CONSTRAINT "creator_pilots_qualification_id_creator_qualifications_id_fk" FOREIGN KEY ("qualification_id") REFERENCES "public"."creator_qualifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_previews" ADD CONSTRAINT "creator_previews_pilot_check" CHECK ("creator_previews"."pilot_id" IS NULL OR ("creator_previews"."kind" IN ('answer', 'grounded-answer') AND "creator_previews"."evaluation" IS NULL));--> statement-breakpoint
ALTER TABLE "creator_previews" ADD CONSTRAINT "creator_previews_grounding_check" CHECK (("creator_previews"."kind" = 'grounded-answer') = ("creator_previews"."grounding" IS NOT NULL)
      AND ("creator_previews"."grounding" IS NULL OR (jsonb_typeof("creator_previews"."grounding") = 'object' AND octet_length("creator_previews"."grounding"::text) <= 131072 AND ("creator_previews"."evaluation" IS NOT NULL OR "creator_previews"."pilot_id" IS NOT NULL)))
      AND ("creator_previews"."grounded_answer" IS NULL OR ("creator_previews"."kind" = 'grounded-answer' AND "creator_previews"."status" = 'completed' AND octet_length("creator_previews"."grounded_answer"::text) <= 65536)));