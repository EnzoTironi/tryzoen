CREATE TABLE "payload_inventory_cursor" (
	"prefix" text PRIMARY KEY NOT NULL,
	"continuation_token" text,
	CONSTRAINT "payload_inventory_cursor_prefix_check" CHECK (length("payload_inventory_cursor"."prefix") BETWEEN 1 AND 128 AND "payload_inventory_cursor"."prefix" ~ '^[a-z0-9]+([/-][a-z0-9]+)*$'),
	CONSTRAINT "payload_inventory_cursor_token_check" CHECK ("payload_inventory_cursor"."continuation_token" IS NULL OR length("payload_inventory_cursor"."continuation_token") BETWEEN 1 AND 8192)
);
--> statement-breakpoint
CREATE TABLE "payload_orphan" (
	"id" uuid PRIMARY KEY NOT NULL,
	"object_key" text NOT NULL,
	"discovered_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"available_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "payload_orphan_object_key_unique" UNIQUE("object_key"),
	CONSTRAINT "payload_orphan_key_check" CHECK (length("payload_orphan"."object_key") BETWEEN 1 AND 512 AND "payload_orphan"."object_key" ~ '^[a-z0-9/-]+$' AND right("payload_orphan"."object_key",36)="payload_orphan"."id"::text)
);
--> statement-breakpoint
CREATE INDEX "payload_orphan_available_idx" ON "payload_orphan" USING btree ("available_at","id");
--> statement-breakpoint
CREATE FUNCTION payload_registration_guard() RETURNS trigger LANGUAGE plpgsql VOLATILE AS $guard$
BEGIN
  PERFORM pg_advisory_xact_lock(194805,hashtext(NEW.id::text));
  IF EXISTS(SELECT 1 FROM payload_orphan WHERE id=NEW.id) THEN
    RAISE EXCEPTION 'An orphan payload candidate cannot be registered again';
  END IF;
  IF NEW.state<>'pending' OR NEW.verified_at IS NOT NULL OR NEW.adopted_at IS NOT NULL
    OR NEW.retired_at IS NOT NULL OR NEW.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Payload registration must begin as unverified pending intent';
  END IF;
  RETURN NEW;
END;
$guard$;
--> statement-breakpoint
CREATE TRIGGER payload_registration_guard BEFORE INSERT ON payload_object FOR EACH ROW EXECUTE FUNCTION payload_registration_guard();
--> statement-breakpoint
CREATE FUNCTION payload_orphan_guard() RETURNS trigger LANGUAGE plpgsql VOLATILE AS $guard$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Orphan payload cleanup coordinates must survive retries';
  END IF;
  IF TG_OP='INSERT' THEN
    PERFORM pg_advisory_xact_lock(194805,hashtext(NEW.id::text));
    IF EXISTS(SELECT 1 FROM payload_object WHERE id=NEW.id) THEN
      RAISE EXCEPTION 'A registered payload cannot be quarantined as an orphan';
    END IF;
    NEW.discovered_at=clock_timestamp();
  ELSIF NEW.id IS DISTINCT FROM OLD.id OR NEW.object_key IS DISTINCT FROM OLD.object_key
    OR NEW.discovered_at IS DISTINCT FROM OLD.discovered_at THEN
    RAISE EXCEPTION 'Orphan payload coordinates are immutable';
  END IF;
  RETURN NEW;
END;
$guard$;
--> statement-breakpoint
CREATE TRIGGER payload_orphan_guard BEFORE INSERT OR UPDATE OR DELETE ON payload_orphan FOR EACH ROW EXECUTE FUNCTION payload_orphan_guard();
