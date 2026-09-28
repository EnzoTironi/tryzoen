CREATE TABLE "message_reactions" (
	"session_id" text NOT NULL,
	"message_id" text NOT NULL,
	"emoji" text NOT NULL,
	CONSTRAINT "message_reactions_session_id_message_id_pk" PRIMARY KEY("session_id","message_id")
);
--> statement-breakpoint
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_session_id_agent_sessions_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."agent_sessions"("session_id") ON DELETE cascade ON UPDATE no action;