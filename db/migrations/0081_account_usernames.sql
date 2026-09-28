ALTER TABLE "user_directory" DROP CONSTRAINT "user_directory_username_key";--> statement-breakpoint
ALTER TABLE "user_directory" DROP CONSTRAINT "user_directory_pkey";--> statement-breakpoint
ALTER TABLE "user_directory" ADD PRIMARY KEY ("username");--> statement-breakpoint
ALTER TABLE "user_directory" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "user_directory" ADD COLUMN "creator_draft_id" uuid;--> statement-breakpoint
ALTER TABLE "user_directory" ADD COLUMN "system_key" text;--> statement-breakpoint
ALTER TABLE "user_directory" ADD COLUMN "kind" text GENERATED ALWAYS AS (CASE WHEN user_id IS NOT NULL THEN 'person' ELSE 'bot' END) STORED;--> statement-breakpoint
ALTER TABLE "user_directory" ADD CONSTRAINT "user_directory_creator_draft_id_creator_drafts_id_fk" FOREIGN KEY ("creator_draft_id") REFERENCES "public"."creator_drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_directory" ADD CONSTRAINT "user_directory_user_id_unique" UNIQUE("user_id");--> statement-breakpoint
ALTER TABLE "user_directory" ADD CONSTRAINT "user_directory_creator_draft_id_unique" UNIQUE("creator_draft_id");--> statement-breakpoint
ALTER TABLE "user_directory" ADD CONSTRAINT "user_directory_system_key_unique" UNIQUE("system_key");--> statement-breakpoint
ALTER TABLE "user_directory" ADD CONSTRAINT "user_directory_owner_check" CHECK (num_nonnulls("user_directory"."user_id", "user_directory"."creator_draft_id", "user_directory"."system_key") = 1);--> statement-breakpoint
ALTER TABLE "user_directory" ADD CONSTRAINT "user_directory_system_check" CHECK ("user_directory"."system_key" IS NULL OR ("user_directory"."system_key" = 'zoen' AND "user_directory"."username" = 'zoen'));
--> statement-breakpoint
INSERT INTO "user_directory" ("username", "system_key") VALUES ('zoen', 'zoen');
