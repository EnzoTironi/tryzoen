CREATE TABLE "workspace_agent_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"username" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"registration_operation_id" uuid NOT NULL,
	"registration_request_hash" text NOT NULL,
	CONSTRAINT "workspace_agent_members_username_check" CHECK ("workspace_agent_members"."username" ~ '^[a-z][a-z0-9_]{2,29}$'),
	CONSTRAINT "workspace_agent_members_name_check" CHECK ("workspace_agent_members"."name" = btrim("workspace_agent_members"."name") AND char_length("workspace_agent_members"."name") BETWEEN 1 AND 60),
	CONSTRAINT "workspace_agent_members_description_check" CHECK (char_length("workspace_agent_members"."description") <= 240),
	CONSTRAINT "workspace_agent_members_registration_hash_check" CHECK ("workspace_agent_members"."registration_request_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "workspace_agent_members_revocation_check" CHECK ("workspace_agent_members"."revoked_at" IS NULL OR "workspace_agent_members"."revoked_at" >= "workspace_agent_members"."created_at")
);
--> statement-breakpoint
ALTER TABLE "workspace_agent_grants" ADD COLUMN "external_member_id" uuid;--> statement-breakpoint
ALTER TABLE "workspace_agent_members" ADD CONSTRAINT "workspace_agent_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_agent_members_username_uidx" ON "workspace_agent_members" USING btree ("workspace_id","username");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_agent_members_registration_uidx" ON "workspace_agent_members" USING btree ("workspace_id","created_by","registration_operation_id");--> statement-breakpoint
ALTER TABLE "workspace_agent_grants" ADD CONSTRAINT "workspace_agent_grants_external_member_id_workspace_agent_members_id_fk" FOREIGN KEY ("external_member_id") REFERENCES "public"."workspace_agent_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workspace_agent_grants_external_member_idx" ON "workspace_agent_grants" USING btree ("external_member_id");--> statement-breakpoint
ALTER TABLE "workspace_agent_grants" ADD CONSTRAINT "workspace_agent_grants_external_subject_check" CHECK ("workspace_agent_grants"."external_member_id" IS NULL OR ("workspace_agent_grants"."requester_user_id" IS NULL
        AND "workspace_agent_grants"."source_workspace_id" IS NULL AND "workspace_agent_grants"."network_kind" IS NULL
        AND "workspace_agent_grants"."network_id" IS NULL AND "workspace_agent_grants"."origin_bot_id" IS NULL));
--> statement-breakpoint
CREATE FUNCTION enforce_agent_grant_subject() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE member_workspace text; member_revoked timestamptz; target_workspace text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.bot_id, NEW.external_member_id, NEW.issued_by) IS DISTINCT FROM
       (OLD.bot_id, OLD.external_member_id, OLD.issued_by) THEN
      RAISE EXCEPTION 'A grant subject and destination cannot be reassigned' USING ERRCODE = '23514';
    END IF;
    IF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NULL THEN
      RAISE EXCEPTION 'A revoked grant cannot be revived' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.external_member_id IS NOT NULL THEN
    SELECT workspace_id, revoked_at INTO member_workspace, member_revoked
      FROM workspace_agent_members WHERE id = NEW.external_member_id FOR SHARE;
    SELECT workspace_id INTO target_workspace FROM workspace_bots WHERE id = NEW.bot_id;
    IF member_workspace IS NULL OR member_workspace IS DISTINCT FROM target_workspace
       OR (member_revoked IS NOT NULL AND NEW.revoked_at IS NULL) THEN
      RAISE EXCEPTION 'Grant requires a current member in the destination workspace' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER workspace_agent_grants_subject_fence BEFORE INSERT OR UPDATE ON workspace_agent_grants
  FOR EACH ROW EXECUTE FUNCTION enforce_agent_grant_subject();
--> statement-breakpoint
CREATE FUNCTION enforce_agent_member_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id, NEW.workspace_id, NEW.created_by, NEW.created_at, NEW.registration_operation_id, NEW.registration_request_hash)
    IS DISTINCT FROM (OLD.id, OLD.workspace_id, OLD.created_by, OLD.created_at, OLD.registration_operation_id, OLD.registration_request_hash)
    OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NULL) THEN
    RAISE EXCEPTION 'Agent identity and registration receipt are immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER workspace_agent_members_identity_fence BEFORE UPDATE ON workspace_agent_members
  FOR EACH ROW EXECUTE FUNCTION enforce_agent_member_identity();
