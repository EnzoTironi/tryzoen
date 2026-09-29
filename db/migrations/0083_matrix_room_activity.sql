CREATE TABLE "matrix_room_activity" (
	"server_name" text NOT NULL,
	"room_id" text NOT NULL,
	"latest_event_id" text,
	"latest_at" bigint,
	"reconciled_at" timestamp with time zone,
	"reconcile_cursor" text,
	"reconcile_attempted_at" timestamp with time zone,
	CONSTRAINT "matrix_room_activity_server_name_room_id_pk" PRIMARY KEY("server_name","room_id")
);
--> statement-breakpoint
CREATE INDEX "matrix_room_activity_order_idx" ON "matrix_room_activity" USING btree ("server_name","latest_at" DESC NULLS LAST,"room_id");