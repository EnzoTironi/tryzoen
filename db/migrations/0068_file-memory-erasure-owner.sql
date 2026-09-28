ALTER TABLE "workspace_memory_erasure" ADD COLUMN "owner_user_id" text;--> statement-breakpoint
CREATE INDEX "workspace_memory_erasure_owner_idx" ON "workspace_memory_erasure" USING btree ("owner_user_id");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION queue_workspace_memory_erasure() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO workspace_memory_erasure(namespace_id, owner_user_id)
    VALUES (OLD.namespace_id, OLD.user_id) ON CONFLICT DO NOTHING;
  RETURN OLD;
END;
$$;
