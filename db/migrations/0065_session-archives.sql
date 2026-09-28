CREATE TABLE "memory_session_sources" (
	"namespace_id" uuid NOT NULL,
	"event_id" text NOT NULL,
	"digest" text NOT NULL,
	"payload" jsonb,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stored_at" timestamp with time zone,
	CONSTRAINT "memory_session_sources_namespace_id_event_id_pk" PRIMARY KEY("namespace_id","event_id"),
	CONSTRAINT "memory_session_source_size" CHECK (octet_length("memory_session_sources"."payload"::text) <= 262144),
	CONSTRAINT "memory_session_source_delivery" CHECK (("memory_session_sources"."payload" IS NULL) = ("memory_session_sources"."stored_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "memory_session_sources" ADD CONSTRAINT "memory_session_sources_namespace_id_workspace_memory_namespace_namespace_id_fk" FOREIGN KEY ("namespace_id") REFERENCES "public"."workspace_memory_namespace"("namespace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memory_session_sources_pending_idx" ON "memory_session_sources" USING btree ("captured_at") WHERE "memory_session_sources"."stored_at" IS NULL;--> statement-breakpoint
CREATE INDEX "memory_session_sources_owner_pending_idx" ON "memory_session_sources" USING btree ("namespace_id") WHERE "memory_session_sources"."stored_at" IS NULL;