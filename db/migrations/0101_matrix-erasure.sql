CREATE TABLE "matrix_erasure_departures" (
	"binding_id" uuid NOT NULL,
	"matrix_id" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"native_retry_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "matrix_erasure_departures_binding_id_matrix_id_pk" PRIMARY KEY("binding_id","matrix_id")
);
--> statement-breakpoint
ALTER TABLE "account_deletion_ledger" ADD COLUMN "matrix_ids" text[] DEFAULT ARRAY[]::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "matrix_erasure_departures" ADD CONSTRAINT "matrix_erasure_departures_binding_id_workspace_group_bindings_id_fk" FOREIGN KEY ("binding_id") REFERENCES "public"."workspace_group_bindings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "matrix_erasure_departures_due_idx" ON "matrix_erasure_departures" USING btree ("native_retry_at","binding_id","matrix_id");--> statement-breakpoint
CREATE INDEX "matrix_erasure_departures_owner_idx" ON "matrix_erasure_departures" USING btree ("owner_user_id");--> statement-breakpoint
ALTER TABLE "account_deletion_ledger" ADD CONSTRAINT "account_deletion_ledger_matrix_ids_check" CHECK (cardinality("account_deletion_ledger"."matrix_ids") = 0 OR ("account_deletion_ledger"."surface" = 'matrix' AND "account_deletion_ledger"."status" = 'pending_external'));