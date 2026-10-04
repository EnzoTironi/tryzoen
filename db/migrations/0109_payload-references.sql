ALTER TABLE "private_artifact" DROP CONSTRAINT "private_artifact_content";--> statement-breakpoint
ALTER TABLE "workspace_repository" DROP CONSTRAINT "workspace_repository_bundle_check";--> statement-breakpoint
ALTER TABLE "workspace_source" DROP CONSTRAINT "workspace_source_content_check";--> statement-breakpoint
ALTER TABLE "private_memory_repository" DROP CONSTRAINT "private_memory_repository_snapshot_check";--> statement-breakpoint
ALTER TABLE "workspace_repository" ALTER COLUMN "payload_object_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_source" ALTER COLUMN "payload_object_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "private_artifact" DROP COLUMN "content";--> statement-breakpoint
ALTER TABLE "workspace_repository" DROP COLUMN "bundle";--> statement-breakpoint
ALTER TABLE "workspace_source" DROP COLUMN "content";--> statement-breakpoint
ALTER TABLE "private_memory_repository" DROP COLUMN "bundle";--> statement-breakpoint
ALTER TABLE "private_artifact" ADD CONSTRAINT "private_artifact_content" CHECK (("private_artifact"."deleted_at" IS NULL AND "private_artifact"."payload_object_id" IS NOT NULL)
        OR ("private_artifact"."deleted_at" IS NOT NULL AND "private_artifact"."payload_object_id" IS NULL AND "private_artifact"."derived_text" IS NULL AND "private_artifact"."derived_kind" IS NULL));--> statement-breakpoint
ALTER TABLE "private_memory_repository" ADD CONSTRAINT "private_memory_repository_snapshot_check" CHECK (("private_memory_repository"."head_sha" IS NULL AND "private_memory_repository"."payload_object_id" IS NULL AND "private_memory_repository"."recorded_at" IS NULL) OR ("private_memory_repository"."head_sha" IS NOT NULL AND "private_memory_repository"."payload_object_id" IS NOT NULL AND "private_memory_repository"."recorded_at" IS NOT NULL AND "private_memory_repository"."head_sha" ~ '^[a-f0-9]{40}$'));