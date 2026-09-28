import { query, transaction } from "../../../db/queries";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { WorkspaceActorSchema } from "../../workspaces/access";
import { type corpusAccessSchema, corpusPageSchema } from "./schema";
import { authorizedCreatorCorpus } from "./access";
import { verifyCorpusManifest } from "./files";
import {
  openCreatorCorpus,
  creatorCorpusTool,
  readCreatorCorpusPage,
} from "./engine";
import { listNotePaths } from "../../memory/ai-memory/notes";

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
    await using engine = await openCreatorCorpus(
      corpus.namespace,
      corpus.initialized
    );
    await verifyCorpusManifest(
      engine.data,
      corpus.manifest,
      corpus.initialized
    );
    const paths = await listNotePaths(engine);
    if (
      paths.some(
        (path) => !corpus.manifest.pages.some((page) => page.path === path)
      )
    )
      throw new Error("Creator corpus contains an unexpected page.");
    for (const page of corpus.manifest.pages) {
      if (!paths.includes(page.path)) {
        if (corpus.initialized)
          throw new Error("An indexed creator corpus lost a source page.");
        const result = z
          .object({
            path: corpusPageSchema.shape.path,
            checkpoint: z.string().regex(/^[a-f0-9]{40}$/),
          })
          .parse(
            await creatorCorpusTool(engine, releaseId, "memory_write_page", {
              path: page.path,
              body: page.body,
              tier: "semantic",
            })
          );
        if (result.path !== page.path)
          throw new Error("Creator corpus wrote an unexpected page.");
      }
      await readCreatorCorpusPage(engine, releaseId, page);
    }
    await engine.checkpoint();
    await authorizedCreatorCorpus(actor, access);
    await query(
      sql`UPDATE creator_release_corpora SET initialized=true WHERE release_id=${releaseId}`
    );
    return {
      releaseId,
      digest: corpus.digest,
      state: "indexed",
      pages: corpus.manifest.pages.length,
      retrieval: "lexical",
      answerMode: "snapshot",
    };
  });
}
