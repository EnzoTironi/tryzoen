CREATE TABLE "goal_preferences" (
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"show_subtitles" boolean DEFAULT true NOT NULL,
	"sort_automatically" boolean DEFAULT true NOT NULL,
	CONSTRAINT "goal_preferences_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "goal_preferences" ADD CONSTRAINT "goal_preferences_workspace_id_user_id_workspace_memberships_workspace_id_user_id_fk" FOREIGN KEY ("workspace_id","user_id") REFERENCES "public"."workspace_memberships"("workspace_id","user_id") ON DELETE cascade ON UPDATE no action;