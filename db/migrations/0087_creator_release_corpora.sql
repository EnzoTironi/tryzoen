CREATE TABLE "creator_release_corpora" (
 "release_id" uuid PRIMARY KEY CONSTRAINT "creator_release_corpora_release_id_creator_releases_id_fk" REFERENCES "creator_releases"("id") ON DELETE CASCADE,
 "namespace_id" uuid CONSTRAINT "creator_release_corpora_namespace_id_unique" UNIQUE NOT NULL,
 "workspace_id" text NOT NULL,
 "user_id" text NOT NULL,
 "manifest" jsonb NOT NULL,
 "digest" text NOT NULL,
 "initialized" boolean DEFAULT false NOT NULL,
 CONSTRAINT "creator_release_corpora_manifest_check" CHECK (jsonb_typeof("manifest") = 'object' AND octet_length("manifest"::text) <= 262144 AND "digest" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TRIGGER creator_release_corpus_erasure_on_delete AFTER DELETE ON creator_release_corpora
FOR EACH ROW EXECUTE FUNCTION queue_workspace_memory_erasure();
