CREATE TABLE "workstream_revisions" (
	"workspace_id" text NOT NULL,
	"scope_key" text NOT NULL,
	"id" text NOT NULL,
	"revision" integer NOT NULL,
	"content" jsonb NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workstream_revisions_workspace_id_scope_key_id_revision_pk" PRIMARY KEY("workspace_id","scope_key","id","revision"),
	CONSTRAINT "workstream_revisions_revision_check" CHECK ("workstream_revisions"."revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "workstream_revisions" ADD CONSTRAINT "workstream_revisions_workspace_id_scope_key_id_workstreams_workspace_id_scope_key_id_fk" FOREIGN KEY ("workspace_id","scope_key","id") REFERENCES "public"."workstreams"("workspace_id","scope_key","id") ON DELETE cascade ON UPDATE no action;