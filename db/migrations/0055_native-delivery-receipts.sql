CREATE TABLE "native_delivery_receipts" (
	"workspace_id" text NOT NULL,
	"input_id" text NOT NULL,
	"session_id" text NOT NULL,
	"digest" text NOT NULL,
	CONSTRAINT "native_delivery_receipts_workspace_id_input_id_pk" PRIMARY KEY("workspace_id","input_id"),
	CONSTRAINT "native_delivery_receipt_digest_check" CHECK ("native_delivery_receipts"."digest" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "native_delivery_receipts" ADD CONSTRAINT "native_delivery_receipts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;