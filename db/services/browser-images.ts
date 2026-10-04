import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { AccessScope } from "@shared/identity/access-scope";
import {
  browserImageArtifactReferenceSchema,
  browserImageArtifactUrl,
  browserImageSourceKindSchema,
  maximumBrowserImageBytes,
  sniffBrowserImageMediaType,
  type BrowserImageArtifactReference,
} from "@shared/browser/artifact";
import type { browserImageArtifacts } from "@db";
import { query, transaction } from "@db/queries";
import {
  requireWorkspaceMembership,
  WorkspaceAccessDenied,
} from "../../server/workspaces/access";
import { withDeadline, withSignal } from "../../server/operations/async";
import {
  PayloadError,
  PayloadReferenceSchema,
} from "../../server/payloads/contract";
import {
  adoptPayload,
  putRegistered,
  readPayload,
  registerPayload,
} from "../../server/payloads/publication";

type ArtifactRow = typeof browserImageArtifacts.$inferSelect;
export type BrowserImageArtifactReservation = Pick<ArtifactRow, "id">;
export type ReservedBrowserImageArtifact =
  | { readonly image: BrowserImageArtifactReference; readonly status: "ready" }
  | {
      readonly reservation: BrowserImageArtifactReservation;
      readonly status: "pending";
    };

const columns = sql`id,workspace_id AS "workspaceId",created_by_user_id AS "createdByUserId",
  root_session_id AS "rootSessionId",worker_session_id AS "workerSessionId",browser_session_id AS "browserSessionId",
  status,label,filename,media_type AS "mediaType",byte_size AS "byteSize",content_hash AS "contentHash",
  payload_object_id AS "payloadId",source_kind AS "sourceKind",idempotency_key AS "idempotencyKey",created_at AS "createdAt"`;

export async function reserveBrowserImageArtifact(
  scope: AccessScope,
  input: {
    readonly browserSessionId: string;
    readonly idempotencyKey: string;
    readonly label: string;
    readonly rootSessionId: string;
    readonly sourceKind: string;
    readonly workerSessionId: string;
  }
): Promise<ReservedBrowserImageArtifact> {
  const label = browserImageArtifactReferenceSchema.shape.label.parse(
    input.label
  );
  const sourceKind = browserImageSourceKindSchema.parse(input.sourceKind);
  const normalized = { ...input, label, sourceKind };
  return withDeadline(
    () =>
      transaction(async () => {
        await requireWorkspaceMembership(scope);
        const existing = await readByIdempotencyKey(
          scope,
          input.idempotencyKey
        );
        if (existing) return reservedResult(existing, normalized);
        const rows =
          await query<ArtifactRow>(sql`INSERT INTO browser_image_artifacts
      (id,workspace_id,created_by_user_id,root_session_id,worker_session_id,browser_session_id,status,label,source_kind,idempotency_key)
      VALUES (${randomUUID()},${scope.workspaceId},${scope.userId},${input.rootSessionId},${input.workerSessionId},${input.browserSessionId},'pending',${label},${sourceKind},${input.idempotencyKey})
      ON CONFLICT (workspace_id,idempotency_key) DO NOTHING RETURNING ${columns}`);
        const row =
          rows[0] ?? (await readByIdempotencyKey(scope, input.idempotencyKey));
        if (!row)
          throw new Error("The browser image reservation was not stored.");
        return reservedResult(row, normalized);
      }),
    Date.now() + 30_000
  );
}

export async function finalizeBrowserImageArtifact(
  scope: AccessScope,
  reservation: BrowserImageArtifactReservation,
  input: {
    readonly bytes: Uint8Array;
    readonly filename: string;
    readonly sourceKind: string;
  },
  signal?: AbortSignal
) {
  const filename = browserImageArtifactReferenceSchema.shape.filename.parse(
    input.filename
  );
  const sourceKind = browserImageSourceKindSchema.parse(input.sourceKind);
  const mediaType = sniffBrowserImageMediaType(input.bytes);
  if (!mediaType || input.bytes.byteLength > maximumBrowserImageBytes)
    throw new PayloadError("invalid");
  const contentHash = createHash("sha256").update(input.bytes).digest("hex");
  return withSignal(signal, () =>
    withDeadline(async () => {
      const initial = await transaction(
        async () => {
          await requireWorkspaceMembership(scope);
          const row = await requireReservation(scope, reservation.id);
          if (row.status === "ready")
            return { kind: "ready", image: toReference(row) } as const;
          const reference = await registerPayload(
            {
              workspaceId: scope.workspaceId,
              ownerGeneration: row.id,
              ownerUserId: scope.userId,
              kind: "browser-image",
            },
            input.bytes
          );
          return { kind: "pending", reference } as const;
        },
        { outermost: true }
      );
      if (initial.kind === "ready") return { image: initial.image };
      await putRegistered(initial.reference, input.bytes);
      return transaction(
        async () => {
          await requireWorkspaceMembership(scope);
          const row = await requireReservation(scope, reservation.id);
          if (row.status === "ready") return { image: toReference(row) };
          await adoptPayload(initial.reference);
          const rows =
            await query<ArtifactRow>(sql`UPDATE browser_image_artifacts
        SET status='ready',filename=${filename},media_type=${mediaType},source_kind=${sourceKind},byte_size=${input.bytes.byteLength},
          content_hash=${contentHash},payload_object_id=${initial.reference.candidateId}
        WHERE id=${row.id} AND status='pending' RETURNING ${columns}`);
          if (!rows[0])
            throw new Error("The browser image manifest was not finalized.");
          return { image: toReference(rows[0]) };
        },
        { outermost: true }
      );
    }, Date.now() + 30_000)
  );
}

/** Account reads use an authenticated user; native delivery additionally binds the workspace and root session. */
export async function readReadyBrowserImageArtifact(
  owner: AccessScope | string,
  artifactId: string,
  options: {
    readonly rootSessionId?: string;
    readonly signal?: AbortSignal;
  } = {}
) {
  const id = z.uuid().parse(artifactId);
  const userId = typeof owner === "string" ? owner : owner.userId;
  return withSignal(options.signal, () =>
    withDeadline(
      () =>
        transaction(async () => {
          let scope: AccessScope;
          if (typeof owner === "string") {
            const hints = await query<
              Pick<ArtifactRow, "workspaceId">
            >(sql`SELECT workspace_id AS "workspaceId"
        FROM browser_image_artifacts WHERE id=${id} AND created_by_user_id=${userId} AND status='ready'`);
            if (!hints[0]) return undefined;
            scope = { userId, workspaceId: hints[0].workspaceId };
          } else scope = owner;
          await requireWorkspaceMembership(scope);
          const rows =
            await query<ArtifactRow>(sql`SELECT ${columns} FROM browser_image_artifacts
      WHERE id=${id} AND workspace_id=${scope.workspaceId} AND created_by_user_id=${scope.userId} AND status='ready'
      ${options.rootSessionId ? sql`AND root_session_id=${options.rootSessionId}` : sql``} FOR SHARE`);
          const row = rows[0];
          if (!row) return undefined;
          const reference = toReference(row);
          const contentHash =
            PayloadReferenceSchema.options[4].shape.sha256.parse(
              row.contentHash
            );
          const bytes = await readPayload(
            {
              workspaceId: scope.workspaceId,
              ownerGeneration: row.id,
              ownerUserId: scope.userId,
              kind: "browser-image",
            },
            z.uuid().parse(row.payloadId)
          );
          if (
            bytes.byteLength !== reference.byteSize ||
            createHash("sha256").update(bytes).digest("hex") !== contentHash ||
            sniffBrowserImageMediaType(bytes) !== reference.mediaType
          )
            throw new PayloadError("corrupt");
          return {
            ...row,
            ...reference,
            bytes,
            contentHash,
            createdAt: z.coerce.date().parse(row.createdAt).toISOString(),
          };
        }),
      Date.now() + 30_000
    )
  ).catch((error: unknown) => {
    if (error instanceof WorkspaceAccessDenied) return undefined;
    throw error;
  });
}

async function requireReservation(scope: AccessScope, id: string) {
  const rows =
    await query<ArtifactRow>(sql`SELECT ${columns} FROM browser_image_artifacts
    WHERE id=${z.uuid().parse(id)} AND workspace_id=${scope.workspaceId} AND created_by_user_id=${scope.userId} FOR UPDATE`);
  if (!rows[0])
    throw new Error("The browser image reservation is no longer available.");
  return rows[0];
}

function reservedResult(
  row: ArtifactRow,
  input: {
    readonly browserSessionId: string;
    readonly label: string;
    readonly rootSessionId: string;
    readonly sourceKind: string;
    readonly workerSessionId: string;
  }
): ReservedBrowserImageArtifact {
  if (
    row.browserSessionId !== input.browserSessionId ||
    row.rootSessionId !== input.rootSessionId ||
    row.workerSessionId !== input.workerSessionId ||
    row.label !== input.label
  )
    throw new Error("The browser image idempotency key is already in use.");
  return row.status === "ready"
    ? { image: toReference(row), status: "ready" }
    : { reservation: { id: row.id }, status: "pending" };
}

function toReference(row: ArtifactRow) {
  return browserImageArtifactReferenceSchema.parse({
    byteSize: row.byteSize,
    filename: row.filename,
    id: row.id,
    label: row.label,
    mediaType: row.mediaType,
    url: browserImageArtifactUrl(row.id),
  });
}

async function readByIdempotencyKey(scope: AccessScope, key: string) {
  const rows =
    await query<ArtifactRow>(sql`SELECT ${columns} FROM browser_image_artifacts
    WHERE workspace_id=${scope.workspaceId} AND created_by_user_id=${scope.userId} AND idempotency_key=${key} FOR SHARE`);
  return rows[0];
}
