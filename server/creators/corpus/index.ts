import { query, transaction } from "../../../db/queries";
import { sql } from "drizzle-orm";
import type { z } from "zod";
import type { WorkspaceActorSchema } from "../../workspaces/access";
import type { corpusAccessSchema } from "./schema";
import { authorizedCreatorCorpus } from "./access";
import { publishCorpusManifest, readCorpusManifest } from "./files";

export function creatorCorpusStatus(
  actor: z.infer<typeof WorkspaceActorSchema>,
  access: z.infer<typeof corpusAccessSchema>
) {
  return transaction(async () => {
    const corpus = await authorizedCreatorCorpus(actor, access);
    return {
      releaseId: corpus.manifest.releaseId,
      digest: corpus.digest,
      state: corpus.initialized ? "indexed" : "not-indexed",
      pages: corpus.manifest.pages.length,
      availability: "checked-on-search",
      retrieval: "lexical",
      answerMode: "snapshot",
    };
  });
}
export function buildCreatorCorpus(
  actor: z.infer<typeof WorkspaceActorSchema>,
  releaseId: string
) {
  return transaction(async () => {
    const access = { kind: "creator" as const, releaseId };
    const corpus = await authorizedCreatorCorpus(actor, access);
    const manifest = await (
      corpus.initialized ? readCorpusManifest : publishCorpusManifest
    )(corpus.namespace, corpus.manifest);
    await authorizedCreatorCorpus(actor, access);
    await query(
      sql`UPDATE creator_release_corpora SET initialized=true WHERE release_id=${releaseId}`
    );
    return {
      releaseId,
      digest: corpus.digest,
      state: "indexed",
      pages: manifest.pages.length,
      retrieval: "lexical",
      answerMode: "snapshot",
    };
  });
}
