ALTER TABLE "workspace_memory_namespace" ADD COLUMN "preference_revision" uuid DEFAULT gen_random_uuid() NOT NULL;
--> statement-breakpoint
ALTER TABLE "account_archive" ADD COLUMN "private_memory_namespace_id" uuid;
--> statement-breakpoint
ALTER TABLE "workspace_memory_namespace" ADD COLUMN "journal_event_count" bigint DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "workspace_memory_namespace" ADD COLUMN "journal_high_water" bigint;
--> statement-breakpoint
ALTER TABLE "workspace_memory_namespace" ADD CONSTRAINT "workspace_memory_namespace_journal_check" CHECK (
  "journal_event_count" BETWEEN 0 AND 9007199254740991 AND
  (("journal_event_count" = 0 AND "journal_high_water" IS NULL) OR
   ("journal_event_count" > 0 AND "journal_high_water" BETWEEN "journal_event_count" AND 9007199254740991))
);
--> statement-breakpoint
CREATE TABLE "private_memory_preference_operation" (
  "namespace_id" uuid NOT NULL,
  "operation_id" text NOT NULL,
  "request_hash" text NOT NULL,
  "enabled" boolean NOT NULL,
  "preference_revision" uuid NOT NULL,
  "decided_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "private_memory_preference_operation_namespace_id_operation_id_pk" PRIMARY KEY ("namespace_id", "operation_id"),
  CONSTRAINT "private_memory_preference_operation_identity_check" CHECK (
    length("operation_id") BETWEEN 1 AND 256 AND "request_hash" ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT "private_memory_preference_operation_namespace_id_workspace_memory_namespace_namespace_id_fk"
    FOREIGN KEY ("namespace_id") REFERENCES "public"."workspace_memory_namespace"("namespace_id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
ALTER TABLE "workspace_memory_namespace" DROP COLUMN "learned_memory_initialized";
--> statement-breakpoint
ALTER TABLE "workspace_memory_namespace" DROP COLUMN "session_memory_initialized";
--> statement-breakpoint
ALTER TABLE "workspace_memory_namespace" DROP COLUMN "pending_operation";
--> statement-breakpoint
ALTER TABLE "workspace_memory_namespace" DROP COLUMN "pending_hash";
