import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { query } from "../../../db/queries";
import type { z } from "zod";
import type { creatorDraftSchema } from "@zoen/companion-ui/creators";
import type { WorkspaceActorSchema } from "../../workspaces/access";
import { readCreatorSource } from "../sources";
import {
  creatorSourceExample,
  creatorSourceMetadataSchema,
} from "../sources/schema";
import { corpusDigest, corpusManifestSchema, corpusPages } from "./schema";

/** Called within release approval's owner/draft locks, after its evidence passes. */
export async function freezeCreatorCorpus(
  actor: z.infer<typeof WorkspaceActorSchema>,
  releaseId: string,
  draft: z.infer<typeof creatorDraftSchema>
) {
  const namespace = randomUUID();
  const pages = corpusPages(
    namespace,
    {
      entryId: draft.id,
      attribution: "Creator-approved guidance",
      rights: null,
      title: draft.content.title,
      kind: "guidance",
      source: null,
    },
    draft.content.playbook
  );
  for (const example of draft.content.examples) {
    const [owned] = await query(
      sql`SELECT id FROM creator_sources WHERE id=${example.id} AND draft_id=${draft.id} AND workspace_id=${actor.workspaceId} AND user_id=${actor.userId}`
    );
    const source = owned ? await readCreatorSource(actor, example.id) : null;
    if (
      source &&
      (source.status !== "reviewed" ||
        JSON.stringify(creatorSourceExample(source)) !==
          JSON.stringify(example))
    )
      throw new Error("Source changed before release approval.");
    const { content: _content, ...metadata } = source?.snapshot ?? {};
    const reference = source
      ? {
          ...source,
          snapshot: creatorSourceMetadataSchema.parse(metadata),
        }
      : null;
    pages.push(
      ...corpusPages(
        namespace,
        {
          entryId: example.id,
          attribution: example.source,
          rights: example.rights,
          title: example.title,
          kind: source
            ? source.snapshot.extraction === "chat-upload"
              ? "uploaded-source"
              : "workspace-source"
            : "authored",
          source: reference,
        },
        example.content
      )
    );
  }
  const manifest = corpusManifestSchema.parse({
    version: 1,
    releaseId,
    draftRevision: draft.revision,
    pages,
  });
  const serialized = JSON.stringify(manifest);
  await query(
    sql`INSERT INTO creator_release_corpora(release_id,namespace_id,workspace_id,user_id,manifest,digest) VALUES (${releaseId},${namespace},${actor.workspaceId},${actor.userId},${serialized}::jsonb,${corpusDigest(serialized)})`
  );
}
