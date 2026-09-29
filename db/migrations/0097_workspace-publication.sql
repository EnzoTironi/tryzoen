ALTER TABLE "workspace_revision" DROP COLUMN "path";--> statement-breakpoint
ALTER TABLE "workspace_revision" ADD COLUMN "paths" text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_revision" ADD CONSTRAINT "workspace_revision_paths_check" CHECK (cardinality("workspace_revision"."paths") BETWEEN 1 AND 24);
