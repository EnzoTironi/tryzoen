CREATE TABLE "matrix_contribution_receipts" (
	"workspace_id" text NOT NULL,
	"operation_id" uuid NOT NULL,
	"owner_user_id" text NOT NULL,
	"request_hash" text NOT NULL,
	"event_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "matrix_contribution_receipts_workspace_id_operation_id_pk" PRIMARY KEY("workspace_id","operation_id"),
	CONSTRAINT "matrix_contribution_receipts_hash_check" CHECK ("matrix_contribution_receipts"."request_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "matrix_contribution_receipts_event_check" CHECK ("matrix_contribution_receipts"."event_id" IS NULL OR char_length("matrix_contribution_receipts"."event_id") BETWEEN 1 AND 256)
);
--> statement-breakpoint
ALTER TABLE "matrix_contribution_receipts" ADD CONSTRAINT "matrix_contribution_receipts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;