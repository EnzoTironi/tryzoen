CREATE TABLE "creator_pilots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"release_id" uuid NOT NULL,
	"workspace_id" text NOT NULL,
	"creator_user_id" text NOT NULL,
	"recipient_user_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creator_pilots_state_check" CHECK ("creator_pilots"."status" IN ('pending', 'active', 'declined', 'withdrawn') AND "creator_pilots"."creator_user_id" <> "creator_pilots"."recipient_user_id")
);
--> statement-breakpoint
ALTER TABLE "creator_previews" ADD COLUMN "pilot_id" uuid;--> statement-breakpoint
ALTER TABLE "creator_pilots" ADD CONSTRAINT "creator_pilots_release_id_creator_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."creator_releases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_pilots" ADD CONSTRAINT "creator_pilots_workspace_id_creator_user_id_workspace_memberships_workspace_id_user_id_fk" FOREIGN KEY ("workspace_id","creator_user_id") REFERENCES "public"."workspace_memberships"("workspace_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_pilots" ADD CONSTRAINT "creator_pilots_workspace_id_recipient_user_id_workspace_memberships_workspace_id_user_id_fk" FOREIGN KEY ("workspace_id","recipient_user_id") REFERENCES "public"."workspace_memberships"("workspace_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "creator_pilots_release_idx" ON "creator_pilots" USING btree ("release_id");--> statement-breakpoint
CREATE INDEX "creator_pilots_creator_idx" ON "creator_pilots" USING btree ("workspace_id","creator_user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "creator_pilots_recipient_idx" ON "creator_pilots" USING btree ("workspace_id","recipient_user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "creator_previews" ADD CONSTRAINT "creator_previews_pilot_id_creator_pilots_id_fk" FOREIGN KEY ("pilot_id") REFERENCES "public"."creator_pilots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_previews" ADD CONSTRAINT "creator_previews_pilot_check" CHECK ("creator_previews"."pilot_id" IS NULL OR ("creator_previews"."kind" = 'answer' AND "creator_previews"."evaluation" IS NULL));