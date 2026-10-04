DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM browser_image_artifacts WHERE status='ready') THEN
    RAISE EXCEPTION 'Existing browser images require a verified transfer before changing their storage';
  END IF;
END;
$guard$;
--> statement-breakpoint
ALTER TABLE payload_object DROP CONSTRAINT payload_object_scope_check;
--> statement-breakpoint
ALTER TABLE payload_object ADD CONSTRAINT payload_object_scope_check CHECK (
  length(workspace_id) BETWEEN 1 AND 200
  AND ((kind IN ('workspace-bundle','workspace-source') AND owner_user_id IS NULL)
    OR (kind IN ('private-memory-bundle','private-artifact','browser-image') AND owner_user_id IS NOT NULL AND length(owner_user_id) BETWEEN 1 AND 200)));
--> statement-breakpoint
ALTER TABLE payload_object DROP CONSTRAINT payload_object_integrity_check;
--> statement-breakpoint
ALTER TABLE payload_object ADD CONSTRAINT payload_object_integrity_check CHECK (
  sha256 ~ '^[a-f0-9]{64}$'
  AND ((kind='workspace-bundle' AND byte_length BETWEEN 0 AND 25165824)
    OR (kind='workspace-source' AND byte_length BETWEEN 0 AND 10485760)
    OR (kind='private-memory-bundle' AND byte_length BETWEEN 1 AND 25165824)
    OR (kind='private-artifact' AND byte_length BETWEEN 1 AND 10485760)
    OR (kind='browser-image' AND byte_length BETWEEN 1 AND 8388608)));
--> statement-breakpoint
ALTER TABLE browser_image_artifacts ADD COLUMN payload_object_id uuid;
--> statement-breakpoint
ALTER TABLE browser_image_artifacts ADD CONSTRAINT browser_image_artifacts_payload_object_id_payload_object_id_fk
  FOREIGN KEY (payload_object_id) REFERENCES public.payload_object(id) ON DELETE NO ACTION ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE browser_image_artifacts DROP COLUMN storage_pathname;
--> statement-breakpoint
ALTER TABLE browser_image_artifacts DROP CONSTRAINT browser_image_artifacts_ready_fields_check;
--> statement-breakpoint
ALTER TABLE browser_image_artifacts ADD CONSTRAINT browser_image_artifacts_ready_fields_check CHECK (
  (status='pending' AND payload_object_id IS NULL AND filename IS NULL AND media_type IS NULL AND byte_size IS NULL AND content_hash IS NULL)
  OR (status='ready' AND payload_object_id IS NOT NULL AND filename IS NOT NULL
    AND media_type IS NOT NULL AND media_type IN ('image/gif','image/jpeg','image/png','image/webp')
    AND byte_size IS NOT NULL AND byte_size BETWEEN 1 AND 8388608
    AND content_hash IS NOT NULL AND content_hash ~ '^[a-f0-9]{64}$'));
--> statement-breakpoint
CREATE INDEX browser_image_artifacts_payload_idx ON browser_image_artifacts(payload_object_id) WHERE payload_object_id IS NOT NULL;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION payload_is_referenced(candidate uuid) RETURNS boolean LANGUAGE sql VOLATILE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM workspace_repository WHERE payload_object_id=candidate)
    OR EXISTS (SELECT 1 FROM workspace_source WHERE payload_object_id=candidate)
    OR EXISTS (SELECT 1 FROM private_memory_repository WHERE payload_object_id=candidate)
    OR EXISTS (SELECT 1 FROM private_artifact WHERE payload_object_id=candidate)
    OR EXISTS (SELECT 1 FROM browser_image_artifacts WHERE payload_object_id=candidate);
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION payload_pointer_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
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
  ELSIF TG_TABLE_NAME='browser_image_artifacts' THEN
    expected_workspace:=NEW.workspace_id;
    expected_generation:=NEW.id;
    expected_user:=NEW.created_by_user_id;
    expected_kind:='browser-image';
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
  IF TG_TABLE_NAME='browser_image_artifacts' THEN
    IF object.sha256<>NEW.content_hash OR object.byte_length<>NEW.byte_size THEN
      RAISE EXCEPTION 'Browser image payload integrity metadata differs';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

--> statement-breakpoint
CREATE TRIGGER browser_image_payload_guard BEFORE INSERT OR UPDATE ON browser_image_artifacts
  FOR EACH ROW EXECUTE FUNCTION payload_pointer_guard();
--> statement-breakpoint
CREATE TRIGGER browser_image_payload_retirement AFTER UPDATE OR DELETE ON browser_image_artifacts
  FOR EACH ROW EXECUTE FUNCTION retire_replaced_payload();
--> statement-breakpoint
CREATE TRIGGER browser_image_payload_erasure_guard BEFORE INSERT OR UPDATE ON browser_image_artifacts
  FOR EACH ROW EXECUTE FUNCTION payload_pointer_erasure_guard();
