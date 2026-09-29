import { sql } from "drizzle-orm";
import { z } from "zod";
import { query } from "../../../db/queries";
import type { WorkspaceActorSchema } from "../../workspaces/access";
import { WorkspaceAccessDenied } from "../../workspaces/access";
import { readCreatorRelease } from "../releases";
import { requireActiveCreatorPilot } from "../pilots";
import {
  corpusAccessSchema,
  corpusDigest,
  corpusManifestSchema,
} from "./schema";

/** Access chooses the namespace server-side; callers never provide a storage path. */
export async function authorizedCreatorCorpus(
  actor: z.infer<typeof WorkspaceActorSchema>,
  raw: z.infer<typeof corpusAccessSchema>
) {
  const access = corpusAccessSchema.parse(raw);
  const releaseId =
    access.kind === "creator"
      ? (await readCreatorRelease(actor, access.releaseId)).id
      : (await requireActiveCreatorPilot(actor, access.pilotId)).releaseId;
  const [stored] = await query(
    sql`SELECT namespace_id AS namespace,manifest,digest,initialized FROM creator_release_corpora WHERE release_id=${releaseId} AND workspace_id=${actor.workspaceId} FOR UPDATE`
  );
  if (!stored)
    throw new Error(
      "This approved version has no frozen corpus manifest. Approve a new version before indexing."
    );
  const corpus = z
    .object({
      namespace: z.uuid(),
      manifest: corpusManifestSchema,
      digest: z.string(),
      initialized: z.boolean(),
    })
    .parse(stored);
  if (
    corpus.manifest.releaseId !== releaseId ||
    corpusDigest(JSON.stringify(corpus.manifest)) !== corpus.digest
  )
    throw new WorkspaceAccessDenied();
  return corpus;
}
