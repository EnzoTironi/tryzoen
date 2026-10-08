CREATE TABLE "mastra_pilot_conversation" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
CREATE TABLE "mastra_pilot_run" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"input" text NOT NULL,
	"status" text NOT NULL,
	"decision" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mastra_pilot_run_status" CHECK ("mastra_pilot_run"."status" IN ('running','suspended','completed','rejected','cancelled','failed')),
	CONSTRAINT "mastra_pilot_run_decision" CHECK ("mastra_pilot_run"."decision" IS NULL OR "mastra_pilot_run"."decision" IN ('approve','reject'))
);

--> statement-breakpoint
ALTER TABLE "mastra_pilot_conversation" ADD CONSTRAINT "mastra_pilot_conversation_id_agent_sessions_session_id_fk" FOREIGN KEY ("id") REFERENCES "public"."agent_sessions"("session_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "mastra_pilot_run" ADD CONSTRAINT "mastra_pilot_run_conversation_id_mastra_pilot_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."mastra_pilot_conversation"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "mastra_pilot_run_conversation_idx" ON "mastra_pilot_run" USING btree ("conversation_id","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "mastra_pilot_one_active_run" ON "mastra_pilot_run" USING btree ("conversation_id") WHERE "mastra_pilot_run"."status" IN ('running', 'suspended');
