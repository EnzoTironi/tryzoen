CREATE TABLE "private_memory_operation" (
	"namespace_id" uuid NOT NULL,
	"operation_id" text NOT NULL,
	"revision" text NOT NULL,
	"parent_revision" text,
	"claim_id" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"author_user_id" text NOT NULL,
	"recorded_at" timestamp(6) with time zone NOT NULL,
	CONSTRAINT "private_memory_operation_namespace_id_operation_id_pk" PRIMARY KEY("namespace_id","operation_id"),
	CONSTRAINT "private_memory_operation_revision_key" UNIQUE("namespace_id","revision"),
	CONSTRAINT "private_memory_operation_identity_check" CHECK (length("private_memory_operation"."operation_id") BETWEEN 1 AND 256 AND "private_memory_operation"."revision" ~ '^[a-f0-9]{40}$' AND ("private_memory_operation"."parent_revision" IS NULL OR "private_memory_operation"."parent_revision" ~ '^[a-f0-9]{40}$') AND "private_memory_operation"."request_hash" ~ '^[a-f0-9]{64}$' AND length("private_memory_operation"."author_user_id") BETWEEN 1 AND 200)
);
--> statement-breakpoint
CREATE TABLE "private_memory_repository" (
	"namespace_id" uuid PRIMARY KEY NOT NULL,
	"head_sha" text,
	"bundle" "bytea",
	"recorded_at" timestamp(6) with time zone,
	CONSTRAINT "private_memory_repository_snapshot_check" CHECK (("private_memory_repository"."head_sha" IS NULL AND "private_memory_repository"."bundle" IS NULL AND "private_memory_repository"."recorded_at" IS NULL) OR ("private_memory_repository"."head_sha" IS NOT NULL AND "private_memory_repository"."bundle" IS NOT NULL AND "private_memory_repository"."recorded_at" IS NOT NULL AND "private_memory_repository"."head_sha" ~ '^[a-f0-9]{40}$' AND octet_length("private_memory_repository"."bundle") BETWEEN 1 AND 25165824))
);
--> statement-breakpoint
ALTER TABLE "private_memory_operation" ADD CONSTRAINT "private_memory_operation_namespace_id_private_memory_repository_namespace_id_fk" FOREIGN KEY ("namespace_id") REFERENCES "public"."private_memory_repository"("namespace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_memory_repository" ADD CONSTRAINT "private_memory_repository_namespace_id_workspace_memory_namespace_namespace_id_fk" FOREIGN KEY ("namespace_id") REFERENCES "public"."workspace_memory_namespace"("namespace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "private_memory_operation_history_idx" ON "private_memory_operation" USING btree ("namespace_id","recorded_at" DESC NULLS LAST,"revision");