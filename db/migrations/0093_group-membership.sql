ALTER TABLE "matrix_room_members" ADD COLUMN "state" text DEFAULT 'joined' NOT NULL;--> statement-breakpoint
ALTER TABLE "matrix_room_members" ADD COLUMN "native_pending" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "matrix_room_members_pending_idx" ON "matrix_room_members" USING btree ("binding_id") WHERE "matrix_room_members"."native_pending";--> statement-breakpoint
ALTER TABLE "matrix_room_members" ADD CONSTRAINT "matrix_room_members_state_check" CHECK ("matrix_room_members"."state" IN ('joined', 'left', 'removed'));