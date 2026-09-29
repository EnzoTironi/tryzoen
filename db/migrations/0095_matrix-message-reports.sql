CREATE TABLE "matrix_message_reports" (
	"user_id" text NOT NULL,
	"server_name" text NOT NULL,
	"room_id" text NOT NULL,
	"event_id" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "matrix_message_reports_user_id_server_name_event_id_pk" PRIMARY KEY("user_id","server_name","event_id"),
	CONSTRAINT "matrix_message_reports_status_check" CHECK ("matrix_message_reports"."status" IN ('submitted', 'uncertain'))
);
--> statement-breakpoint
ALTER TABLE "matrix_message_reports" ADD CONSTRAINT "matrix_message_reports_user_id_matrix_identities_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."matrix_identities"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "matrix_message_reports_quota_idx" ON "matrix_message_reports" USING btree ("user_id","created_at");