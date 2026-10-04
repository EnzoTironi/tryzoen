CREATE TABLE "payload_object" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"owner_generation" uuid NOT NULL,
	"owner_user_id" text,
	"kind" text NOT NULL,
	"sha256" text NOT NULL,
	"byte_length" integer NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"write_until" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"adopted_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"retired_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "payload_object_scope_check" CHECK (length("payload_object"."workspace_id") BETWEEN 1 AND 200
        AND (("payload_object"."kind" IN ('workspace-bundle', 'workspace-source') AND "payload_object"."owner_user_id" IS NULL)
          OR ("payload_object"."kind" IN ('private-memory-bundle', 'private-artifact') AND "payload_object"."owner_user_id" IS NOT NULL AND length("payload_object"."owner_user_id") BETWEEN 1 AND 200))),
	CONSTRAINT "payload_object_integrity_check" CHECK ("payload_object"."sha256" ~ '^[a-f0-9]{64}$'
        AND (("payload_object"."kind" = 'workspace-bundle' AND "payload_object"."byte_length" BETWEEN 0 AND 25165824)
          OR ("payload_object"."kind" = 'workspace-source' AND "payload_object"."byte_length" BETWEEN 0 AND 10485760)
          OR ("payload_object"."kind" = 'private-memory-bundle' AND "payload_object"."byte_length" BETWEEN 1 AND 25165824)
          OR ("payload_object"."kind" = 'private-artifact' AND "payload_object"."byte_length" BETWEEN 1 AND 10485760))),
	CONSTRAINT "payload_object_state_check" CHECK (("payload_object"."state" = 'pending' AND "payload_object"."adopted_at" IS NULL AND "payload_object"."retired_at" IS NULL AND "payload_object"."deleted_at" IS NULL)
        OR ("payload_object"."state" = 'adopted' AND "payload_object"."verified_at" IS NOT NULL AND "payload_object"."adopted_at" IS NOT NULL AND "payload_object"."deleted_at" IS NULL)
        OR ("payload_object"."state" = 'deleting' AND "payload_object"."deleted_at" IS NULL)
        OR ("payload_object"."state" = 'deleted' AND "payload_object"."deleted_at" IS NOT NULL)),
	CONSTRAINT "payload_object_write_window_check" CHECK ("payload_object"."write_until" > "payload_object"."created_at" AND "payload_object"."write_until" <= "payload_object"."created_at" + interval '2 minutes'),
	CONSTRAINT "payload_object_verified_time_check" CHECK ("payload_object"."verified_at" IS NULL OR "payload_object"."verified_at" BETWEEN "payload_object"."created_at" AND "payload_object"."write_until")
);
--> statement-breakpoint
ALTER TABLE "private_artifact" ADD COLUMN "payload_object_id" uuid;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "payload_generation" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_repository" ADD COLUMN "payload_object_id" uuid;--> statement-breakpoint
ALTER TABLE "workspace_source" ADD COLUMN "payload_object_id" uuid;--> statement-breakpoint
ALTER TABLE "private_memory_repository" ADD COLUMN "payload_object_id" uuid;--> statement-breakpoint
CREATE INDEX "payload_object_collection_idx" ON "payload_object" USING btree ("state","write_until","retired_at","id");--> statement-breakpoint
CREATE INDEX "payload_object_owner_idx" ON "payload_object" USING btree ("workspace_id","kind","owner_generation");--> statement-breakpoint
CREATE INDEX "payload_object_private_owner_idx" ON "payload_object" USING btree ("owner_user_id");--> statement-breakpoint
ALTER TABLE "private_artifact" ADD CONSTRAINT "private_artifact_payload_object_id_payload_object_id_fk" FOREIGN KEY ("payload_object_id") REFERENCES "public"."payload_object"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_repository" ADD CONSTRAINT "workspace_repository_payload_object_id_payload_object_id_fk" FOREIGN KEY ("payload_object_id") REFERENCES "public"."payload_object"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_source" ADD CONSTRAINT "workspace_source_payload_object_id_payload_object_id_fk" FOREIGN KEY ("payload_object_id") REFERENCES "public"."payload_object"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_memory_repository" ADD CONSTRAINT "private_memory_repository_payload_object_id_payload_object_id_fk" FOREIGN KEY ("payload_object_id") REFERENCES "public"."payload_object"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "private_artifact_payload_idx" ON "private_artifact" USING btree ("payload_object_id") WHERE "private_artifact"."payload_object_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "workspace_repository_payload_idx" ON "workspace_repository" USING btree ("payload_object_id") WHERE "workspace_repository"."payload_object_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "workspace_source_payload_idx" ON "workspace_source" USING btree ("payload_object_id") WHERE "workspace_source"."payload_object_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "private_memory_repository_payload_idx" ON "private_memory_repository" USING btree ("payload_object_id") WHERE "private_memory_repository"."payload_object_id" IS NOT NULL;
--> statement-breakpoint
CREATE FUNCTION payload_is_referenced(candidate uuid) RETURNS boolean LANGUAGE sql VOLATILE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM workspace_repository WHERE payload_object_id=candidate)
    OR EXISTS (SELECT 1 FROM workspace_source WHERE payload_object_id=candidate)
    OR EXISTS (SELECT 1 FROM private_memory_repository WHERE payload_object_id=candidate)
    OR EXISTS (SELECT 1 FROM private_artifact WHERE payload_object_id=candidate);
$$;
--> statement-breakpoint
CREATE FUNCTION payload_coordinate_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Payload coordinates must remain available for deletion retries';
  END IF;
  IF ROW(NEW.id,NEW.workspace_id,NEW.owner_generation,NEW.owner_user_id,NEW.kind,NEW.sha256,NEW.byte_length,NEW.created_at,NEW.write_until)
    IS DISTINCT FROM ROW(OLD.id,OLD.workspace_id,OLD.owner_generation,OLD.owner_user_id,OLD.kind,OLD.sha256,OLD.byte_length,OLD.created_at,OLD.write_until) THEN
    RAISE EXCEPTION 'Payload coordinates are immutable';
  END IF;
  IF (OLD.verified_at IS NOT NULL AND NEW.verified_at IS DISTINCT FROM OLD.verified_at)
    OR (OLD.adopted_at IS NOT NULL AND NEW.adopted_at IS DISTINCT FROM OLD.adopted_at)
    OR (OLD.retired_at IS NOT NULL AND NEW.retired_at IS DISTINCT FROM OLD.retired_at) THEN
    RAISE EXCEPTION 'Payload publication receipts are immutable';
  END IF;
  IF OLD.verified_at IS NULL AND NEW.verified_at IS NOT NULL
    AND (OLD.state<>'pending' OR NEW.state<>'pending' OR NEW.write_until<=clock_timestamp()) THEN
    RAISE EXCEPTION 'Payload verification window has closed';
  END IF;
  IF NEW.state IS DISTINCT FROM OLD.state AND NOT (
    (OLD.state='pending' AND NEW.state='adopted' AND OLD.verified_at IS NOT NULL AND OLD.write_until>clock_timestamp())
    OR (OLD.state='pending' AND NEW.state='deleting' AND OLD.write_until<=clock_timestamp())
    OR (OLD.state='adopted' AND NEW.state='deleting')
    OR (OLD.state='deleting' AND NEW.state='deleted')
    OR (OLD.state='deleted' AND NEW.state='deleting')
  ) THEN
    RAISE EXCEPTION 'Invalid payload state transition';
  END IF;
  IF (NEW.state IN ('deleting','deleted') OR NEW.retired_at IS NOT NULL)
    AND payload_is_referenced(OLD.id) THEN
    RAISE EXCEPTION 'A referenced payload cannot be collected or retired';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER payload_coordinate_guard BEFORE UPDATE OR DELETE ON payload_object
  FOR EACH ROW EXECUTE FUNCTION payload_coordinate_guard();
--> statement-breakpoint
CREATE FUNCTION payload_pointer_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
  expected_workspace text;
  expected_generation uuid;
  expected_user text;
  expected_kind text;
  object payload_object%ROWTYPE;
BEGIN
  IF NEW.payload_object_id IS NULL THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME IN ('workspace_repository','workspace_source') THEN
    expected_workspace:=NEW.workspace_id;
    SELECT payload_generation INTO STRICT expected_generation FROM workspaces WHERE id=NEW.workspace_id FOR SHARE;
    expected_kind:=CASE WHEN TG_TABLE_NAME='workspace_repository' THEN 'workspace-bundle' ELSE 'workspace-source' END;
  ELSIF TG_TABLE_NAME='private_memory_repository' THEN
    SELECT workspace_id,namespace_id,user_id INTO STRICT expected_workspace,expected_generation,expected_user
      FROM workspace_memory_namespace WHERE namespace_id=NEW.namespace_id FOR SHARE;
    expected_kind:='private-memory-bundle';
  ELSIF TG_TABLE_NAME='private_artifact' THEN
    expected_workspace:=NEW.workspace_id;
    expected_generation:=NEW.id;
    expected_user:=NEW.owner_user_id;
    expected_kind:='private-artifact';
  ELSE
    RAISE EXCEPTION 'Unknown payload owner';
  END IF;
  SELECT * INTO STRICT object FROM payload_object WHERE id=NEW.payload_object_id FOR SHARE;
  IF object.workspace_id IS DISTINCT FROM expected_workspace
    OR object.owner_generation IS DISTINCT FROM expected_generation
    OR object.owner_user_id IS DISTINCT FROM expected_user
    OR object.kind<>expected_kind OR object.state<>'adopted'
    OR object.verified_at IS NULL OR object.retired_at IS NOT NULL THEN
    RAISE EXCEPTION 'Payload does not match its canonical owner';
  END IF;
  IF TG_TABLE_NAME='private_artifact' THEN
    IF object.sha256<>NEW.sha256 OR object.byte_length<>NEW.byte_length THEN
      RAISE EXCEPTION 'Artifact payload integrity metadata differs';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION retire_replaced_payload() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF OLD.payload_object_id IS NULL THEN RETURN NULL; END IF;
  IF TG_OP<>'DELETE' THEN
    IF NEW.payload_object_id IS NOT DISTINCT FROM OLD.payload_object_id THEN RETURN NULL; END IF;
  END IF;
  UPDATE payload_object SET retired_at=COALESCE(retired_at,clock_timestamp())
    WHERE id=OLD.payload_object_id AND state='adopted'
      AND NOT payload_is_referenced(OLD.payload_object_id);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER workspace_repository_payload_guard BEFORE INSERT OR UPDATE ON workspace_repository
  FOR EACH ROW EXECUTE FUNCTION payload_pointer_guard();
--> statement-breakpoint
CREATE TRIGGER workspace_source_payload_guard BEFORE INSERT OR UPDATE ON workspace_source
  FOR EACH ROW EXECUTE FUNCTION payload_pointer_guard();
--> statement-breakpoint
CREATE TRIGGER private_memory_payload_guard BEFORE INSERT OR UPDATE ON private_memory_repository
  FOR EACH ROW EXECUTE FUNCTION payload_pointer_guard();
--> statement-breakpoint
CREATE TRIGGER private_artifact_payload_guard BEFORE INSERT OR UPDATE ON private_artifact
  FOR EACH ROW EXECUTE FUNCTION payload_pointer_guard();
--> statement-breakpoint
CREATE TRIGGER workspace_repository_payload_retirement AFTER UPDATE OR DELETE ON workspace_repository
  FOR EACH ROW EXECUTE FUNCTION retire_replaced_payload();
--> statement-breakpoint
CREATE TRIGGER workspace_source_payload_retirement AFTER UPDATE OR DELETE ON workspace_source
  FOR EACH ROW EXECUTE FUNCTION retire_replaced_payload();
--> statement-breakpoint
CREATE TRIGGER private_memory_payload_retirement AFTER UPDATE OR DELETE ON private_memory_repository
  FOR EACH ROW EXECUTE FUNCTION retire_replaced_payload();
--> statement-breakpoint
CREATE TRIGGER private_artifact_payload_retirement AFTER UPDATE OR DELETE ON private_artifact
  FOR EACH ROW EXECUTE FUNCTION retire_replaced_payload();
--> statement-breakpoint
CREATE FUNCTION freeze_workspace_payload_generation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF NEW.payload_generation IS DISTINCT FROM OLD.payload_generation THEN
    RAISE EXCEPTION 'Workspace payload generations are immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER workspace_payload_generation_guard BEFORE UPDATE OF payload_generation ON workspaces
  FOR EACH ROW EXECUTE FUNCTION freeze_workspace_payload_generation();
