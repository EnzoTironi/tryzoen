import { createHash } from "node:crypto";
import { query, transaction } from "@db/queries";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { HookEvent } from "eve/hooks";
import { inlineAttachmentSchema } from "@zoen/companion-ui/messages";
import {
  WorkspaceAccessDenied,
  type WorkspaceActorSchema,
} from "../../workspaces/access";
import { lockCreatorDrafts, readCreatorDraft } from "../drafts";
import { acquireCreatorUploadSource, listCreatorSources } from "../sources";
import {
  creatorUploadSnapshotSchema,
  creatorIntakeStartSchema,
} from "./schema";

const intakeSchema = z.object({
  id: z.uuid(),
  draftId: z.uuid(),
  draftRevision: z.uuid(),
  sessionId: z.string(),
  armedTurnId: z.string(),
  title: z.string(),
  status: z.enum(["waiting", "acquired", "cancelled", "expired", "rejected"]),
  sourceId: z.uuid().nullable(),
  failure: z.string().nullable(),
  createdAt: z.number(),
  expiresAt: z.number(),
});
const projection = sql`id,draft_id AS "draftId",draft_revision AS "draftRevision",session_id AS "sessionId",armed_turn_id AS "armedTurnId",title,status,source_id AS "sourceId",failure,extract(epoch FROM created_at)::float8*1000 AS "createdAt",extract(epoch FROM expires_at)::float8*1000 AS "expiresAt"`;

async function requireSession(
  actor: z.infer<typeof WorkspaceActorSchema>,
  sessionId: string
) {
  const rows = await query(
    sql`SELECT session_id FROM agent_sessions WHERE session_id=${sessionId} AND workspace_id=${actor.workspaceId} AND created_by_user_id=${actor.userId} FOR SHARE`
  );
  if (!rows.length) throw new WorkspaceAccessDenied();
}
async function expireIntakes(actor: z.infer<typeof WorkspaceActorSchema>) {
  await query(
    sql`UPDATE creator_source_intakes SET status='expired' WHERE workspace_id=${actor.workspaceId} AND user_id=${actor.userId} AND status='waiting' AND expires_at<=clock_timestamp()`
  );
  // Metadata only, max50 per owner. Acquired source snapshots have their own explicit retention.
  await query(
    sql`DELETE FROM creator_source_intakes WHERE workspace_id=${actor.workspaceId} AND user_id=${actor.userId} AND created_at<clock_timestamp()-interval '24 hours'`
  );
}
export function startCreatorIntake(
  actor: z.infer<typeof WorkspaceActorSchema>,
  sessionId: string,
  turnId: string,
  raw: z.infer<typeof creatorIntakeStartSchema>
) {
  const input = creatorIntakeStartSchema.parse(raw);
  return transaction(async () => {
    await lockCreatorDrafts(actor);
    await requireSession(actor, sessionId);
    await expireIntakes(actor);
    const draft = await readCreatorDraft(actor, input.draftId);
    const [existing] = await query(
      sql`SELECT ${projection} FROM creator_source_intakes WHERE id=${input.id} AND workspace_id=${actor.workspaceId} AND user_id=${actor.userId}`
    );
    if (existing) {
      const saved = intakeSchema.parse(existing);
      if (
        saved.sessionId !== sessionId ||
        saved.armedTurnId !== turnId ||
        saved.draftId !== input.draftId ||
        saved.draftRevision !== input.expectedDraftRevision ||
        saved.title !== input.title
      )
        throw new Error(
          "This upload request was already saved for different content."
        );
      return saved;
    }
    if (draft.archivedAt || draft.revision !== input.expectedDraftRevision)
      throw new Error(
        "The draft changed. Open a new upload request for its current version."
      );
    if ((await listCreatorSources(actor, draft.id)).length >= 20)
      throw new Error("This draft already has 20 source snapshots.");
    const [capacity] = await query<{ count: number }>(
      sql`SELECT count(*)::int AS count FROM creator_source_intakes WHERE workspace_id=${actor.workspaceId} AND user_id=${actor.userId}`
    );
    if (!capacity || capacity.count >= 50)
      throw new Error("Too many upload requests today. Try again later.");
    const waiting = await query(
      sql`SELECT id FROM creator_source_intakes WHERE workspace_id=${actor.workspaceId} AND user_id=${actor.userId} AND session_id=${sessionId} AND status='waiting'`
    );
    if (waiting.length)
      throw new Error(
        "There is already an upload request in this chat. Complete or cancel it first."
      );
    const [row] = await query(
      sql`INSERT INTO creator_source_intakes(id,workspace_id,user_id,draft_id,draft_revision,session_id,armed_turn_id,title) VALUES(${input.id},${actor.workspaceId},${actor.userId},${input.draftId},${input.expectedDraftRevision},${sessionId},${turnId},${input.title}) ON CONFLICT(id) DO NOTHING RETURNING ${projection}`
    );
    if (!row) throw new WorkspaceAccessDenied();
    return intakeSchema.parse(row);
  });
}
export function readCreatorIntake(
  actor: z.infer<typeof WorkspaceActorSchema>,
  sessionId: string,
  id: string,
  cancel = false
) {
  return transaction(async () => {
    await lockCreatorDrafts(actor);
    await requireSession(actor, sessionId);
    await expireIntakes(actor);
    if (cancel)
      await query(
        sql`UPDATE creator_source_intakes SET status='cancelled' WHERE id=${id} AND workspace_id=${actor.workspaceId} AND user_id=${actor.userId} AND session_id=${sessionId} AND status='waiting'`
      );
    const [row] = await query(
      sql`SELECT ${projection} FROM creator_source_intakes WHERE id=${id} AND workspace_id=${actor.workspaceId} AND user_id=${actor.userId} AND session_id=${sessionId}`
    );
    if (!row) throw new WorkspaceAccessDenied();
    return intakeSchema.parse(row);
  });
}
/** Public native hook event only. Never accept caller-selected session IDs or model text as uploads. */
function rejectUpload(failure: string) {
  return { failure, snapshot: undefined };
}

function parseUpload(
  event: HookEvent<"message.received">,
  sessionId: string,
  title: string
) {
  const files =
    event.data.parts?.flatMap((part, index) =>
      part.type === "file" ? [{ part, index }] : []
    ) ?? [];
  if (files.length !== 1)
    return rejectUpload("Send one text or Markdown file per upload request.");
  const file = files[0];
  const url = file?.part.url;
  const filename = file?.part.filename;
  if (
    !file ||
    !url ||
    !filename ||
    !/^.+\.(?:md|txt)$/iu.test(filename) ||
    url.length > 128512 ||
    !creatorUploadSnapshotSchema.shape.mediaType.safeParse(file.part.mediaType)
      .success
  )
    return rejectUpload(
      "Send a UTF-8 .txt or .md file directly in this chat. Links and other file types are not imported."
    );
  const attachment = inlineAttachmentSchema.safeParse({ ...file.part, url });
  if (
    !attachment.success ||
    Buffer.byteLength(url.slice(url.indexOf(",") + 1), "base64") > 96000
  )
    return rejectUpload(
      "This source must fit within 96 KB and 24,000 characters; it will not be truncated."
    );
  try {
    const bytes = Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
    const content = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(bytes);
    for (const character of content) {
      const code = character.charCodeAt(0);
      if (code < 32 && code !== 9 && code !== 10 && code !== 13)
        throw new Error("Not plain text");
    }
    return {
      failure: null,
      snapshot: creatorUploadSnapshotSchema.parse({
        title,
        filename,
        mediaType: file.part.mediaType,
        sessionId,
        eventId: event.meta.id,
        turnId: event.data.turnId,
        partIndex: file.index,
        uploadedAt: event.meta.at,
        extraction: "chat-upload",
        content,
        digest: createHash("sha256").update(bytes).digest("hex"),
      }),
    };
  } catch {
    return rejectUpload(
      "The file must contain valid UTF-8 text, with 1–24,000 characters. Nothing was imported."
    );
  }
}

export function captureCreatorUpload(
  actor: z.infer<typeof WorkspaceActorSchema>,
  sessionId: string,
  event: HookEvent<"message.received">
) {
  if (event.data.kind) return Promise.resolve(null);
  const files =
    event.data.parts?.flatMap((part, index) =>
      part.type === "file" ? [{ part, index }] : []
    ) ?? [];
  if (!files.length) return Promise.resolve(null);
  return transaction(async () => {
    await lockCreatorDrafts(actor);
    await requireSession(actor, sessionId);
    await expireIntakes(actor);
    const [row] = await query(
      sql`SELECT ${projection} FROM creator_source_intakes WHERE workspace_id=${actor.workspaceId} AND user_id=${actor.userId} AND session_id=${sessionId} AND status='waiting' FOR UPDATE`
    );
    if (!row) return null;
    const intake = intakeSchema.parse(row);
    // A historical replay before the explicit request must never arm itself retroactively.
    if (
      event.data.turnId === intake.armedTurnId ||
      Date.parse(event.meta.at) <= intake.createdAt
    )
      return null;
    const draft = await readCreatorDraft(actor, intake.draftId);
    let failure: string | null;
    let snapshot: z.infer<typeof creatorUploadSnapshotSchema> | undefined;
    if (draft.archivedAt || draft.revision !== intake.draftRevision)
      failure =
        "The draft changed. Request another upload for its current version.";
    else if ((await listCreatorSources(actor, draft.id)).length >= 20)
      failure = "This draft already has 20 source snapshots.";
    else ({ failure, snapshot } = parseUpload(event, sessionId, intake.title));
    if (failure) {
      await query(
        sql`UPDATE creator_source_intakes SET status='rejected',failure=${failure} WHERE id=${intake.id}`
      );
      return { status: "rejected", message: failure };
    }
    if (!snapshot) throw new Error("Missing verified upload");
    const source = await acquireCreatorUploadSource(
      actor,
      {
        id: intake.id,
        draftId: intake.draftId,
        expectedDraftRevision: intake.draftRevision,
      },
      snapshot
    );
    const consumed = await query(
      sql`UPDATE creator_source_intakes SET status='acquired',source_id=${source.id} WHERE id=${intake.id} AND expires_at>clock_timestamp() RETURNING id`
    );
    if (!consumed.length)
      throw new Error(
        "The upload request expired before the file could be saved. Nothing was imported."
      );
    return { status: "acquired", sourceId: source.id };
  });
}
