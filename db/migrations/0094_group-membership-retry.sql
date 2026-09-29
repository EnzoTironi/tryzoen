DROP INDEX "matrix_room_members_pending_idx";--> statement-breakpoint
ALTER TABLE "matrix_room_members" ADD COLUMN "native_retry_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "matrix_room_members_pending_idx" ON "matrix_room_members" USING btree ("native_retry_at","binding_id") WHERE "matrix_room_members"."native_pending";