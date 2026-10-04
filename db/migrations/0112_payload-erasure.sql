CREATE TABLE "payload_erasure" (
	"owner_user_id" text NOT NULL,
	"scope_key" text NOT NULL,
	"personal_workspace_id" text,
	"phase" text DEFAULT 'private' NOT NULL,
	"continuation_token" text,
	"requested_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"available_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "payload_erasure_owner_user_id_scope_key_pk" PRIMARY KEY("owner_user_id","scope_key"),
	CONSTRAINT "payload_erasure_owner_check" CHECK (length("payload_erasure"."owner_user_id") BETWEEN 1 AND 200 AND "payload_erasure"."owner_user_id"=btrim("payload_erasure"."owner_user_id")),
	CONSTRAINT "payload_erasure_scope_check" CHECK (("payload_erasure"."scope_key"='account' AND "payload_erasure"."personal_workspace_id" IS NOT NULL AND "payload_erasure"."personal_workspace_id"='personal:' || substring(encode(sha256(convert_to("payload_erasure"."owner_user_id",'UTF8')),'hex'),1,32)) OR ("payload_erasure"."scope_key" ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' AND "payload_erasure"."personal_workspace_id" IS NULL)),
	CONSTRAINT "payload_erasure_phase_check" CHECK ("payload_erasure"."phase"='private' OR ("payload_erasure"."phase"='personal' AND "payload_erasure"."scope_key"='account')),
	CONSTRAINT "payload_erasure_token_check" CHECK ("payload_erasure"."continuation_token" IS NULL OR length("payload_erasure"."continuation_token") BETWEEN 1 AND 8192)
);
--> statement-breakpoint
CREATE INDEX "payload_erasure_available_idx" ON "payload_erasure" USING btree ("available_at","owner_user_id","scope_key");--> statement-breakpoint
CREATE INDEX "payload_erasure_namespace_idx" ON "payload_erasure" USING btree ("scope_key");
--> statement-breakpoint
CREATE FUNCTION payload_erasure_guard() RETURNS trigger LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,public,pg_temp AS $guard$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Payload privacy erasure coordinates must survive retries';
  END IF;
  IF TG_OP='INSERT' THEN
    PERFORM pg_advisory_xact_lock(194806,hashtext(NEW.owner_user_id));
    IF NEW.scope_key='account' THEN
      PERFORM pg_advisory_xact_lock(194807,hashtext(NEW.personal_workspace_id));
      IF NOT EXISTS(SELECT 1 FROM account_deletion_tombstones WHERE user_id=NEW.owner_user_id) THEN
        RAISE EXCEPTION 'Account payload erasure requires its committed deletion intent';
      END IF;
    ELSIF NOT EXISTS(SELECT 1 FROM workspace_memory_erasure
      WHERE namespace_id::text=NEW.scope_key AND owner_user_id=NEW.owner_user_id) THEN
      RAISE EXCEPTION 'Namespace payload erasure requires its exact owner deletion intent';
    END IF;
    NEW.requested_at=clock_timestamp();
  ELSIF NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
    OR NEW.scope_key IS DISTINCT FROM OLD.scope_key
    OR NEW.personal_workspace_id IS DISTINCT FROM OLD.personal_workspace_id
    OR NEW.requested_at IS DISTINCT FROM OLD.requested_at THEN
    RAISE EXCEPTION 'Payload privacy erasure coordinates are immutable';
  END IF;
  RETURN NEW;
END;
$guard$;
--> statement-breakpoint
CREATE TRIGGER payload_erasure_guard BEFORE INSERT OR UPDATE OR DELETE ON payload_erasure
  FOR EACH ROW EXECUTE FUNCTION payload_erasure_guard();
--> statement-breakpoint
CREATE FUNCTION require_payload_owner_available(target_workspace text,target_user text,target_generation uuid,target_kind text)
RETURNS void LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,public,pg_temp AS $guard$
BEGIN
  IF target_user IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(194806,hashtext(target_user));
  ELSE
    PERFORM pg_advisory_xact_lock(194807,hashtext(target_workspace));
  END IF;
  IF EXISTS(SELECT 1 FROM payload_erasure e WHERE
    (target_user IS NOT NULL AND e.owner_user_id=target_user
      AND (e.scope_key='account' OR (target_kind='private-memory-bundle' AND e.scope_key=target_generation::text)))
    OR (target_user IS NULL AND e.scope_key='account' AND e.personal_workspace_id=target_workspace)) THEN
    RAISE EXCEPTION 'An erased payload owner cannot register or publish bytes';
  END IF;
END;
$guard$;
--> statement-breakpoint
CREATE FUNCTION payload_registration_erasure_guard() RETURNS trigger LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,public,pg_temp AS $guard$
BEGIN
  PERFORM require_payload_owner_available(NEW.workspace_id,NEW.owner_user_id,NEW.owner_generation,NEW.kind);
  RETURN NEW;
END;
$guard$;
--> statement-breakpoint
CREATE TRIGGER payload_registration_erasure_guard BEFORE INSERT ON payload_object
  FOR EACH ROW EXECUTE FUNCTION payload_registration_erasure_guard();
--> statement-breakpoint
CREATE FUNCTION payload_pointer_erasure_guard() RETURNS trigger LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,public,pg_temp AS $guard$
DECLARE
  coordinate payload_object%ROWTYPE;
BEGIN
  IF NEW.payload_object_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO STRICT coordinate FROM payload_object WHERE id=NEW.payload_object_id;
  PERFORM require_payload_owner_available(coordinate.workspace_id,coordinate.owner_user_id,coordinate.owner_generation,coordinate.kind);
  RETURN NEW;
END;
$guard$;
--> statement-breakpoint
CREATE TRIGGER workspace_repository_payload_erasure_guard BEFORE INSERT OR UPDATE ON workspace_repository
  FOR EACH ROW EXECUTE FUNCTION payload_pointer_erasure_guard();
--> statement-breakpoint
CREATE TRIGGER workspace_source_payload_erasure_guard BEFORE INSERT OR UPDATE ON workspace_source
  FOR EACH ROW EXECUTE FUNCTION payload_pointer_erasure_guard();
--> statement-breakpoint
CREATE TRIGGER private_memory_payload_erasure_guard BEFORE INSERT OR UPDATE ON private_memory_repository
  FOR EACH ROW EXECUTE FUNCTION payload_pointer_erasure_guard();
--> statement-breakpoint
CREATE TRIGGER private_artifact_payload_erasure_guard BEFORE INSERT OR UPDATE ON private_artifact
  FOR EACH ROW EXECUTE FUNCTION payload_pointer_erasure_guard();
