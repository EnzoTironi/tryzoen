import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { query, transaction } from "../../db/queries";
import {
  creatorExampleSchema,
  creatorDraftContentSchema,
} from "@zoen/companion-ui/creators";
import {
  WorkspaceAccessDenied,
  type WorkspaceActorSchema,
} from "../workspaces/access";
import { WorkspaceRepository } from "../workspaces/repository";
import {
  CreatorDraftConflict,
  readCreatorDraft,
  requireCreator,
  lockCreatorDrafts,
  saveCreatorDraft,
} from "./drafts";
import {
  creatorSourceAcquireSchema,
  creatorSourceChangeSchema,
  creatorSourceExample,
  creatorSourceSchema,
  creatorSourceSnapshotSchema,
} from "./sources/schema";

const projection = sql`id, draft_id AS "draftId", revision, status, rights,
  to_char(acquired_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "acquiredAt",
  to_char(reviewed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "reviewedAt",
  to_char(withdrawn_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "withdrawnAt"`;
export function readCreatorSource(
  actor: z.infer<typeof WorkspaceActorSchema>,
  id: string
) {
  return transaction(async () => {
    await requireCreator(actor);
    const [row] = await query(
      sql`SELECT ${projection}, snapshot FROM creator_sources WHERE id=${id} AND workspace_id=${actor.workspaceId} AND user_id=${actor.userId}`
    );
    if (!row) throw new WorkspaceAccessDenied();
    return creatorSourceSchema.parse(row);
  });
}
export function listCreatorSources(
  actor: z.infer<typeof WorkspaceActorSchema>,
  draftId: string
) {
  return transaction(async () => {
    await readCreatorDraft(actor, draftId);
    const rows = await query(
      sql`SELECT ${projection}, snapshot - 'content' AS snapshot FROM creator_sources WHERE draft_id=${draftId} AND workspace_id=${actor.workspaceId} AND user_id=${actor.userId} ORDER BY acquired_at DESC,id DESC LIMIT 20`
    );
    return z
      .array(
        creatorSourceSchema.extend({
          snapshot: creatorSourceSnapshotSchema.omit({ content: true }),
        })
      )
      .max(20)
      .parse(rows);
  });
}
export function acquireCreatorSource(
  actor: z.infer<typeof WorkspaceActorSchema>,
  raw: z.infer<typeof creatorSourceAcquireSchema>
) {
  const input = creatorSourceAcquireSchema.parse(raw);
  return transaction(async () => {
    await lockCreatorDrafts(actor);
    const draft = await readCreatorDraft(actor, input.draftId);
    const existing = await query(
      sql`SELECT ${projection}, snapshot FROM creator_sources WHERE id=${input.id} AND workspace_id=${actor.workspaceId} AND user_id=${actor.userId}`
    );
    if (existing[0]) {
      const saved = creatorSourceSchema.parse(existing[0]);
      if (
        saved.draftId !== input.draftId ||
        saved.snapshot.path !== input.path ||
        saved.snapshot.fileRevision !== input.fileRevision ||
        saved.snapshot.title !== input.title
      )
        throw new CreatorDraftConflict();
      return saved;
    }
    if (draft.content.examples.some((example) => example.id === input.id))
      throw new Error(
        "This source identity is already used by an authored example. Choose a new source UUID."
      );
    if (draft.archivedAt || draft.revision !== input.expectedDraftRevision)
      throw new CreatorDraftConflict();
    if ((await listCreatorSources(actor, input.draftId)).length >= 20)
      throw new Error(
        "A draft can retain up to 20 source snapshots, including withdrawn sources."
      );
    const file = await WorkspaceRepository.read(
      actor,
      input.path,
      input.fileRevision
    );
    // Preserve exact bytes: validation must not silently trim the acquired file.
    const content = z
      .string()
      .min(1)
      .max(24000)
      .refine((text) => text.trim().length > 0)
      .parse(file.content);
    const snapshot = creatorSourceSnapshotSchema.parse({
      title: input.title,
      path: input.path,
      fileRevision: file.revision,
      content,
      digest: createHash("sha256").update(content).digest("hex"),
      extraction: "workspace-markdown",
    });
    const inserted = await query(
      sql`INSERT INTO creator_sources (id,workspace_id,user_id,draft_id,snapshot) VALUES (${input.id},${actor.workspaceId},${actor.userId},${input.draftId},${JSON.stringify(snapshot)}::jsonb) ON CONFLICT(id) DO NOTHING RETURNING id`
    );
    if (!inserted.length) throw new WorkspaceAccessDenied();
    return readCreatorSource(actor, input.id);
  });
}
export function reviewCreatorSource(
  actor: z.infer<typeof WorkspaceActorSchema>,
  raw: z.infer<typeof creatorSourceChangeSchema>,
  rawRights: z.infer<typeof creatorExampleSchema>["rights"]
) {
  const input = creatorSourceChangeSchema.parse(raw);
  const rights = creatorExampleSchema.shape.rights.parse(rawRights);
  return transaction(async () => {
    await lockCreatorDrafts(actor);
    const source = await readCreatorSource(actor, input.id);
    const draft = await readCreatorDraft(actor, source.draftId);
    if (
      source.status === "reviewed" &&
      source.rights === rights &&
      draft.content.examples.some(
        (example) =>
          JSON.stringify(example) ===
          JSON.stringify(creatorSourceExample(source))
      )
    )
      return { source, draft };
    if (
      source.status !== "acquired" ||
      source.revision !== input.expectedRevision ||
      draft.archivedAt ||
      draft.revision !== input.expectedDraftRevision
    )
      throw new CreatorDraftConflict();
    const content = creatorDraftContentSchema.parse({
      ...draft.content,
      examples: [
        ...draft.content.examples,
        creatorSourceExample({ ...source, rights }),
      ],
    });
    if (Buffer.byteLength(JSON.stringify(content), "utf8") > 48000)
      throw new Error(
        "This source would exceed the 48 KB preview limit. Shorten the authored guidance or select a smaller source; nothing was applied."
      );
    await query(
      sql`UPDATE creator_sources SET status='reviewed',rights=${rights},reviewed_at=clock_timestamp(),revision=${randomUUID()} WHERE id=${input.id}`
    );
    const saved = await saveCreatorDraft(actor, {
      id: draft.id,
      expectedRevision: draft.revision,
      content,
    });
    return { source: await readCreatorSource(actor, input.id), draft: saved };
  });
}
export function withdrawCreatorSource(
  actor: z.infer<typeof WorkspaceActorSchema>,
  raw: z.infer<typeof creatorSourceChangeSchema>
) {
  const input = creatorSourceChangeSchema.parse(raw);
  return transaction(async () => {
    await lockCreatorDrafts(actor);
    const source = await readCreatorSource(actor, input.id);
    const draft = await readCreatorDraft(actor, source.draftId);
    if (source.status === "withdrawn") return { source, draft };
    if (
      source.revision !== input.expectedRevision ||
      draft.archivedAt ||
      draft.revision !== input.expectedDraftRevision
    )
      throw new CreatorDraftConflict();
    await query(
      sql`UPDATE creator_sources SET status='withdrawn',withdrawn_at=clock_timestamp(),revision=${randomUUID()} WHERE id=${input.id}`
    );
    const saved = await saveCreatorDraft(actor, {
      id: draft.id,
      expectedRevision: draft.revision,
      content: {
        ...draft.content,
        examples: draft.content.examples.filter(
          (example) =>
            source.status !== "reviewed" ||
            JSON.stringify(example) !==
              JSON.stringify(creatorSourceExample(source))
        ),
      },
    });
    return { source: await readCreatorSource(actor, input.id), draft: saved };
  });
}
