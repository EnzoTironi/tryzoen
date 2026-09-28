CREATE TABLE "matrix_direct_rooms" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"first_user_id" text NOT NULL,
	"second_user_id" text NOT NULL,
	"room_id" text NOT NULL,
	"server_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "matrix_direct_rooms_room_id_unique" UNIQUE("room_id"),
	CONSTRAINT "matrix_direct_rooms_pair_order" CHECK ("matrix_direct_rooms"."first_user_id" < "matrix_direct_rooms"."second_user_id")
);
--> statement-breakpoint
ALTER TABLE "matrix_direct_rooms" ADD CONSTRAINT "matrix_direct_rooms_first_member_fk" FOREIGN KEY ("workspace_id","first_user_id") REFERENCES "public"."workspace_memberships"("workspace_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matrix_direct_rooms" ADD CONSTRAINT "matrix_direct_rooms_second_member_fk" FOREIGN KEY ("workspace_id","second_user_id") REFERENCES "public"."workspace_memberships"("workspace_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "matrix_direct_rooms_pair_idx" ON "matrix_direct_rooms" USING btree ("workspace_id","first_user_id","second_user_id");--> statement-breakpoint
CREATE INDEX "matrix_direct_rooms_first_idx" ON "matrix_direct_rooms" USING btree ("workspace_id","first_user_id","id");--> statement-breakpoint
CREATE INDEX "matrix_direct_rooms_second_idx" ON "matrix_direct_rooms" USING btree ("workspace_id","second_user_id","id");