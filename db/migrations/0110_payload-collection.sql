CREATE SCHEMA "zoen_maintenance";
--> statement-breakpoint
CREATE TABLE "zoen_maintenance"."payload_backup_inventory" (
	"repository" text PRIMARY KEY NOT NULL,
	"oldest_backup_start" timestamp with time zone NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "payload_backup_inventory_repository" CHECK ("zoen_maintenance"."payload_backup_inventory"."repository" = 'zoen'),
	CONSTRAINT "payload_backup_inventory_time" CHECK ("zoen_maintenance"."payload_backup_inventory"."oldest_backup_start" <= "zoen_maintenance"."payload_backup_inventory"."observed_at")
);
--> statement-breakpoint
ALTER TABLE "payload_object" ADD COLUMN "available_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL;--> statement-breakpoint
CREATE INDEX "payload_object_available_idx" ON "payload_object" USING btree ("available_at","id");
--> statement-breakpoint
REVOKE ALL ON SCHEMA zoen_maintenance FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA zoen_maintenance FROM PUBLIC;
--> statement-breakpoint
DO $payload_inventory$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='zoen_app') THEN
    GRANT USAGE ON SCHEMA zoen_maintenance TO zoen_app;
    GRANT SELECT ON zoen_maintenance.payload_backup_inventory TO zoen_app;
  END IF;
END;
$payload_inventory$;
