ALTER TABLE "account_archive" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "organization_invites" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tool_call_accounting" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tool_call_allocations" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "account_archive" CASCADE;--> statement-breakpoint
DROP TABLE "organization_invites" CASCADE;--> statement-breakpoint
DROP TABLE "tool_call_accounting" CASCADE;--> statement-breakpoint
DROP TABLE "tool_call_allocations" CASCADE;--> statement-breakpoint
ALTER TABLE "channel_auth_challenge" DROP CONSTRAINT "channel_auth_challenge_archive_check";--> statement-breakpoint
ALTER TABLE "channel_auth_challenge" DROP CONSTRAINT "channel_auth_challenge_source_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "channel_auth_challenge" DROP COLUMN "source_user_id";