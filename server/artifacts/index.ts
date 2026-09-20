import { query, transaction as withDatabaseTransaction } from "@db/queries";
import { sql } from "drizzle-orm";
import { ZodError as SchemaError } from "zod";
import { SqlError } from "../../db/queries";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { artifactAccess } from "./access";
import { artifactDigest, verifiedArtifact } from "./content";
import {
  ArtifactAccessSchema,
  ArtifactDeriveSchema,
  ArtifactError,
  ArtifactListSchema,
  ArtifactMetadataSchema,
  ArtifactPutSchema,
  ArtifactRowSchema,
  ArtifactSourceSchema,
  decodeArtifactInput,
  type ArtifactRow,
} from "./model";
function unavailable(): never {
  throw new ArtifactError({
    reason: "unavailable",
  });
}
function corrupt(): never {
  throw new ArtifactError({
    reason: "corrupt",
  });
}
const { requireArtifactActor, readArtifactSource } = await artifactAccess();
const metadataColumns = sql`a.id AS "artifactId", a.sha256, a.filename, a.media_type AS "mediaType",
    a.byte_length AS "byteLength", a.created_at::text AS "createdAt", a.source_event_id AS "sourceEventId",
    a.source_message_id AS "sourceMessageId", a.source_media_id AS "sourceMediaId"`;
const rowColumns = sql`${metadataColumns}, a.owner_user_id AS "ownerUserId", a.workspace_id AS "workspaceId",
    a.source_identity_id AS "sourceIdentityId", a.source_inbox_id AS "sourceInboxId", a.content,
    a.derived_text AS "derivedText", a.derived_kind AS "derivedKind", a.deleted_at IS NOT NULL AS deleted`;
const requireRow = async function (
  input: z.output<typeof ArtifactAccessSchema>,
  write: boolean
) {
  const scope = await requireArtifactActor(input.identityId);
  const rows = await query(sql`SELECT ${rowColumns} FROM private_artifact a
      WHERE a.id = ${input.artifactId} AND a.workspace_id = ${scope.workspaceId}
      AND a.owner_user_id = ${scope.userId} ${write ? sql`FOR UPDATE` : sql`FOR SHARE`}`);
  if (!rows[0])
    throw new ArtifactError({
      reason: "not_found",
    });
  try {
    return await ArtifactRowSchema.parseAsync(rows[0]);
  } catch {
    return corrupt();
  }
};
const requireSourceOwner = async function (row: ArtifactRow) {
  const sourceScope = await requireArtifactActor(row.sourceIdentityId);
  if (
    sourceScope.userId !== row.ownerUserId ||
    sourceScope.workspaceId !== row.workspaceId
  )
    throw new ArtifactError({
      reason: "not_found",
    });
  return undefined;
};
const findSource = async function (
  input: z.output<typeof ArtifactSourceSchema>
) {
  const scope = await requireArtifactActor(input.identityId);
  const source = await readArtifactSource(input);
  const rows = await query(sql`SELECT ${rowColumns} FROM private_artifact a
      WHERE a.source_identity_id = ${input.identityId} AND a.source_event_id = ${source.sourceEventId}
      AND a.source_media_id = ${source.sourceMediaId} FOR SHARE`);
  if (!rows[0])
    return {
      scope,
      source,
      row: null,
    };
  const row = await Promise.try(async () =>
    ArtifactRowSchema.parseAsync(rows[0])
  ).catch(() => {
    return corrupt();
  });
  if (
    row.ownerUserId !== scope.userId ||
    row.workspaceId !== scope.workspaceId ||
    row.sourceInboxId !== input.sourceInboxId ||
    row.sourceMessageId !== source.sourceMessageId ||
    row.filename !== source.filename ||
    row.mediaType !== source.mediaType
  )
    throw new ArtifactError({
      reason: "source_conflict",
    });
  return {
    scope,
    source,
    row,
  };
};
export const Artifacts = {
  readForSource: async function (input: z.output<typeof ArtifactSourceSchema>) {
    try {
      try {
        return await withDatabaseTransaction(async () => {
          const value = await decodeArtifactInput(ArtifactSourceSchema, input);
          const stored = await findSource(value);
          return stored.row ? await verifiedArtifact(stored.row) : null;
        });
      } catch (error) {
        if (error instanceof SqlError) {
          return unavailable();
        }
        throw error;
      }
    } catch (error) {
      if (error instanceof SchemaError) {
        return corrupt();
      }
      throw error;
    }
  },
  put: async function (input: z.output<typeof ArtifactPutSchema>) {
    try {
      try {
        return await withDatabaseTransaction(async () => {
          const value = await decodeArtifactInput(ArtifactPutSchema, input);
          const bytes = Buffer.from(value.bytes);
          const sha256 = artifactDigest(bytes);
          const stored = await findSource(value);
          if (stored.row) {
            const existing = await verifiedArtifact(stored.row);
            if (
              existing.metadata.sha256 !== sha256 ||
              existing.metadata.byteLength !== bytes.length
            )
              throw new ArtifactError({
                reason: "source_conflict",
              });
            return existing.metadata;
          }
          const { source, scope } = stored;
          await query(sql`INSERT INTO private_artifact
          (id, owner_user_id, workspace_id, source_identity_id, source_inbox_id, source_event_id,
           source_message_id, source_media_id, filename, media_type, byte_length, sha256, content)
          VALUES (${randomUUID()}, ${scope.userId}, ${scope.workspaceId}, ${value.identityId},
            ${value.sourceInboxId}, ${source.sourceEventId}, ${source.sourceMessageId}, ${source.sourceMediaId},
            ${source.filename}, ${source.mediaType}, ${bytes.length}, ${sha256}, ${bytes})
          ON CONFLICT (source_identity_id, source_event_id, source_media_id) DO NOTHING`);
          const current = await findSource(value);
          if (!current.row) return unavailable();
          const saved = await verifiedArtifact(current.row);
          if (
            saved.metadata.sha256 !== sha256 ||
            saved.metadata.byteLength !== bytes.length
          )
            throw new ArtifactError({
              reason: "source_conflict",
            });
          return saved.metadata;
        });
      } catch (error) {
        if (error instanceof SqlError) {
          return unavailable();
        }
        throw error;
      }
    } catch (error) {
      if (error instanceof SchemaError) {
        return corrupt();
      }
      throw error;
    }
  },
  read: async function (input: z.output<typeof ArtifactAccessSchema>) {
    try {
      try {
        return await withDatabaseTransaction(async () => {
          const value = await decodeArtifactInput(ArtifactAccessSchema, input);
          const row = await requireRow(value, false);
          await requireSourceOwner(row);
          return await verifiedArtifact(row);
        });
      } catch (error) {
        if (error instanceof SqlError) {
          return unavailable();
        }
        throw error;
      }
    } catch (error) {
      if (error instanceof SchemaError) {
        return corrupt();
      }
      throw error;
    }
  },
  list: async function (input: z.output<typeof ArtifactListSchema>) {
    try {
      try {
        return await withDatabaseTransaction(async () => {
          const value = await decodeArtifactInput(ArtifactListSchema, input);
          const scope = await requireArtifactActor(value.identityId);
          const rows =
            await query(sql`SELECT ${metadataColumns} FROM private_artifact a
          INNER JOIN channel_identity i ON i.id = a.source_identity_id AND i.revoked_at IS NULL
          WHERE a.workspace_id = ${scope.workspaceId} AND a.owner_user_id = ${scope.userId}
          AND ('better-auth:' || i.user_id) = ${scope.userId} AND a.deleted_at IS NULL
          ORDER BY a.created_at DESC, a.id DESC LIMIT ${value.limit} FOR SHARE OF a, i`);
          return await z.array(ArtifactMetadataSchema).parseAsync(rows);
        });
      } catch (error) {
        if (error instanceof SqlError) {
          return unavailable();
        }
        throw error;
      }
    } catch (error) {
      if (error instanceof SchemaError) {
        return corrupt();
      }
      throw error;
    }
  },
  setDerived: async function (input: z.output<typeof ArtifactDeriveSchema>) {
    try {
      try {
        return await withDatabaseTransaction(async () => {
          const value = await decodeArtifactInput(ArtifactDeriveSchema, input);
          const row = await requireRow(value, true);
          await requireSourceOwner(row);
          const existing = await verifiedArtifact(row);
          if (existing.metadata.sha256 !== value.sha256)
            throw new ArtifactError({
              reason: "source_conflict",
            });
          await query(sql`UPDATE private_artifact SET derived_text = ${value.text}, derived_kind = ${value.kind},
          updated_at = clock_timestamp() WHERE id = ${value.artifactId} AND deleted_at IS NULL`);
          return existing.metadata;
        });
      } catch (error) {
        if (error instanceof SqlError) {
          return unavailable();
        }
        throw error;
      }
    } catch (error) {
      if (error instanceof SchemaError) {
        return corrupt();
      }
      throw error;
    }
  },
  delete: async function (input: z.output<typeof ArtifactAccessSchema>) {
    try {
      try {
        return await withDatabaseTransaction(async () => {
          const value = await decodeArtifactInput(ArtifactAccessSchema, input);
          await requireRow(value, true);
          await query(sql`UPDATE private_artifact SET content = NULL, derived_text = NULL, derived_kind = NULL,
          deleted_at = COALESCE(deleted_at, clock_timestamp()), updated_at = clock_timestamp()
          WHERE id = ${value.artifactId} AND deleted_at IS NULL`);
          return {
            artifactId: value.artifactId,
            status: "deleted" as const,
          };
        });
      } catch (error) {
        if (error instanceof SqlError) {
          return unavailable();
        }
        throw error;
      }
    } catch (error) {
      if (error instanceof SchemaError) {
        return corrupt();
      }
      throw error;
    }
  },
};
