CREATE TABLE "tool_call_accounting" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"key_fingerprint" text NOT NULL,
	CONSTRAINT "tool_call_accounting_key_unique" UNIQUE("id","key_fingerprint"),
	CONSTRAINT "tool_call_accounting_singleton_check" CHECK ("tool_call_accounting"."id" = 1),
	CONSTRAINT "tool_call_accounting_key_check" CHECK ("tool_call_accounting"."key_fingerprint" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "tool_call_allocations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"accounting_id" integer DEFAULT 1 NOT NULL,
	"key_fingerprint" text NOT NULL,
	"operation_hash" text NOT NULL,
	"request_hash" text NOT NULL,
	"actor_hash" text NOT NULL,
	"payer_hash" text NOT NULL,
	"window_date" date NOT NULL,
	"status" text NOT NULL,
	"consumed_calls" integer,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp (3) with time zone,
	CONSTRAINT "tool_call_allocations_hashes_check" CHECK ("tool_call_allocations"."operation_hash" ~ '^[0-9a-f]{64}$' AND "tool_call_allocations"."request_hash" ~ '^[0-9a-f]{64}$' AND "tool_call_allocations"."actor_hash" ~ '^[0-9a-f]{64}$' AND "tool_call_allocations"."payer_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "tool_call_allocations_state_check" CHECK (CASE
    WHEN "tool_call_allocations"."status" = 'settled' THEN "tool_call_allocations"."consumed_calls" IS NOT NULL AND "tool_call_allocations"."consumed_calls" IN (0,1) AND "tool_call_allocations"."settled_at" IS NOT NULL
    WHEN "tool_call_allocations"."status" IN ('reserved', 'uncertain') THEN "tool_call_allocations"."consumed_calls" IS NULL AND "tool_call_allocations"."settled_at" IS NULL
    ELSE false END)
);
--> statement-breakpoint
ALTER TABLE "tool_call_allocations" ADD CONSTRAINT "tool_call_allocations_accounting_key_fkey" FOREIGN KEY ("accounting_id","key_fingerprint") REFERENCES "public"."tool_call_accounting"("id","key_fingerprint") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE UNIQUE INDEX "tool_call_allocations_operation_uidx" ON "tool_call_allocations" USING btree ("operation_hash");--> statement-breakpoint
CREATE INDEX "tool_call_allocations_actor_window_idx" ON "tool_call_allocations" USING btree ("actor_hash","window_date");