import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import { mapAsync } from "../operations/async";
import { z } from "zod";
import { Mem0 } from "../memory/mem0";
import { requireControlSession } from "./controls";

const Id = z.uuid();
const Cursor = z.string().regex(/^[0-9]{1,20}$/);
const FileCursor = z.string().regex(/^[0-9a-f-]{0,40}$/);
const Archive = z.object({
  id: Id,
  sourceUserId: z.string(),
  workspaceId: z.string(),
  createdAt: z.string(),
});
export class AccountArchiveMissing extends Error {
  readonly _tag = "AccountArchiveMissing";

  constructor() {
    super("AccountArchiveMissing");
    this.name = "AccountArchiveMissing";
  }
}

const ownedArchives = async function (headers: Headers, id?: string) {
  const session = await requireControlSession(headers);

  if (id !== undefined) await Id.parseAsync(id);
  const rows =
    await query(sql`SELECT id, source_user_id AS "sourceUserId", workspace_id AS "workspaceId",
    to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt"
    FROM account_archive WHERE target_user_id = ${session.user.id}
    AND (${id === undefined} OR id = ${id ?? null}) ORDER BY created_at DESC`);
  return await z.array(Archive).parseAsync(rows);
};

export const readAccountArchives = async function (headers: Headers) {
  return (await ownedArchives(headers)).map(({ id, createdAt }) => ({
    id,
    createdAt,
  }));
};

export const readAccountArchive = async function (
  headers: Headers,
  id: string,
  after = "0",
  filesAfter = ""
) {
  const cursor = await Cursor.parseAsync(after);
  const fileCursor = await FileCursor.parseAsync(filesAfter);
  const archive = (await ownedArchives(headers, id))[0];
  if (!archive) throw new AccountArchiveMissing();

  const messages = await query<{
    cursor: string;
    direction: string;
    text: string;
    at: string;
  }>(sql`
    SELECT cursor::text, direction, text, at::text FROM (
      SELECT row_number() OVER (ORDER BY at, id) AS cursor, direction, text, at FROM (
      SELECT q.id, 'inbound' AS direction,
        COALESCE(q.payload->>'text', '') AS text, q.received_at AS at
      FROM channel_inbox q JOIN channel_identity i ON i.id = q.identity_id WHERE i.user_id = ${archive.sourceUserId}
      UNION ALL SELECT q.id, 'outbound', COALESCE(q.payload->>'text', ''), q.created_at
      FROM channel_outbox q JOIN channel_identity i ON i.id = q.identity_id WHERE i.user_id = ${archive.sourceUserId}
    ) history) ordered WHERE cursor > ${cursor}::numeric ORDER BY cursor LIMIT 51`);
  const attachments = await query<{
    id: string;
    filename: string;
    kind: "attachment" | "source";
  }>(sql`SELECT id, filename, kind FROM (
    SELECT id::text, filename, 'attachment' AS kind FROM private_artifact
    WHERE workspace_id = ${archive.workspaceId} AND owner_user_id = ${`better-auth:${archive.sourceUserId}`} AND deleted_at IS NULL
    UNION ALL SELECT revision, filename, 'source' FROM workspace_source WHERE workspace_id = ${archive.workspaceId}
    ) files WHERE id > ${fileCursor} ORDER BY id LIMIT 51`);
  const repositories = await query(
    sql`SELECT head_sha FROM workspace_repository WHERE workspace_id = ${archive.workspaceId}`
  );
  return {
    id: archive.id,
    createdAt: archive.createdAt,
    messages: messages.slice(0, 50),
    next: messages.length > 50 ? messages[49]?.cursor : undefined,
    attachments: attachments.slice(0, 50),
    nextFile: attachments.length > 50 ? attachments[49]?.id : undefined,
    hasRepository: repositories.length === 1,
  };
};

export const downloadAccountArchive = async function (
  headers: Headers,
  id: string,
  section: "memory" | "files" | "attachment" | "source",
  attachmentId?: string
) {
  const archive = (await ownedArchives(headers, id))[0];
  if (!archive) throw new AccountArchiveMissing();

  const responseHeaders = {
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
    "content-disposition": `attachment; filename="zoen-${archive.id}-${section}.${section === "memory" ? "json" : section === "files" ? "bundle" : "bin"}"`,
  };
  if (section === "files") {
    const files = await query<{
      bundle: Uint8Array;
    }>(
      sql`SELECT bundle FROM workspace_repository WHERE workspace_id = ${archive.workspaceId}`
    );
    if (!files[0]) throw new AccountArchiveMissing();
    return new Response(new Uint8Array(files[0].bundle), {
      headers: {
        ...responseHeaders,
        "content-type": "application/octet-stream",
      },
    });
  }
  if (section === "source") {
    const revision = await z
      .string()
      .regex(/^[0-9a-f]{40}$/)
      .parseAsync(attachmentId);
    const files = await query<{
      content: Uint8Array;
    }>(
      sql`SELECT content FROM workspace_source WHERE workspace_id = ${archive.workspaceId} AND revision = ${revision}`
    );
    if (!files[0]) throw new AccountArchiveMissing();
    return new Response(new Uint8Array(files[0].content), {
      headers: {
        ...responseHeaders,
        "content-type": "application/octet-stream",
      },
    });
  }
  if (section === "attachment") {
    const key = await Id.parseAsync(attachmentId);
    const files = await query<{
      content: Uint8Array;
    }>(sql`SELECT content FROM private_artifact
      WHERE id = ${key} AND workspace_id = ${archive.workspaceId} AND owner_user_id = ${`better-auth:${archive.sourceUserId}`} AND deleted_at IS NULL`);
    if (!files[0]) throw new AccountArchiveMissing();
    return new Response(new Uint8Array(files[0].content), {
      headers: {
        ...responseHeaders,
        "content-type": "application/octet-stream",
      },
    });
  }
  const profile =
    await query(sql`SELECT first_name, last_name, email, phone, date_of_birth, address_line_1,
    address_line_2, city, region, postal_code, country_code FROM user_profiles WHERE workspace_id = ${archive.workspaceId}`);
  const documents =
    await query(sql`SELECT d.content, d.updated_at FROM memory_document d
    JOIN personal_memory_binding b ON b.key = d.key WHERE b.workspace_id = ${archive.workspaceId}`);
  const namespaces = await query<{
    id: string;
  }>(sql`SELECT namespace_id AS id FROM workspace_memory_namespace
    WHERE workspace_id = ${archive.workspaceId} AND user_id = ${`better-auth:${archive.sourceUserId}`}`);
  const mem0 = Mem0;
  const learned = await mapAsync(
    namespaces,
    (namespace) => mem0.read(namespace.id),
    1
  );
  return Response.json(
    {
      profile: profile[0] ?? null,
      documents,
      learned: learned.flatMap((page) => page.results),
    },
    { headers: responseHeaders }
  );
};
