import { query, transaction as withDatabaseTransaction } from "@db/queries";
import { sql } from "drizzle-orm";
import { ZodError as SchemaError } from "zod";
import { SqlError } from "../../db/queries";
import { jsonString, isValid } from "@shared/validation";
import { z } from "zod";
import {
  decodeCustomerTool,
  PublishedToolPath,
  ToolProposalPath,
} from "./tool-document";
import { readAgentGrantCapabilities } from "./bots";
import {
  ontologyPath,
  type OntologyActionSchema,
} from "@shared/workspaces/ontology";
import { createHash } from "node:crypto";
import {
  requireWorkspaceAccess,
  WorkspaceAccessDenied,
  type WorkspaceActorSchema,
} from "./access";
import {
  capabilitiesPath,
  WorkspaceCapabilitiesSchema,
} from "@shared/workspaces/capabilities";
import {
  GitRevisionSchema,
  publishWorkspaceGit,
  readWorkspaceGit,
  readWorkspaceGitSelection,
  searchWorkspaceGit,
  WorkspacePathSchema,
} from "./git";
import {
  isSkillContentPath,
  PublishedSkillPath,
  SkillDocumentSchema,
  SkillProposalPath,
  skillPathFromProposal,
} from "./skill-document";
export const WorkspaceWriteSchema = z.object({
  operationId: z.uuid(),
  expectedRevision: z.nullable(GitRevisionSchema),
  path: WorkspacePathSchema,
  content: z.nullable(z.string().max(262_144)),
});
export class WorkspaceRepositoryError extends Error {
  readonly _tag = "WorkspaceRepositoryError";
  declare readonly reason:
    | "conflict"
    | "not_found"
    | "invalid_input"
    | "unavailable";
  constructor(input: {
    readonly reason: "conflict" | "not_found" | "invalid_input" | "unavailable";
  }) {
    super("WorkspaceRepositoryError");
    this.name = "WorkspaceRepositoryError";
    Object.assign(this, input);
  }
}
const repositorySchema = z.object({
  head: GitRevisionSchema,
  bundle: z.instanceof(Uint8Array),
});
const revisionSchema = z.object({
  revision: GitRevisionSchema,
  parent: z.nullable(GitRevisionSchema),
  path: WorkspacePathSchema,
  author: z.string(),
  createdAt: z.string(),
  source: z.string(),
});
function unavailable(): never {
  throw new WorkspaceRepositoryError({
    reason: "unavailable",
  });
}
const importSourceSchema = z.object({
  filename: z.string().min(1).max(255),
  bytes: z
    .instanceof(Uint8Array)
    .refine((value) => value.byteLength <= 10_485_760),
});

/** Shared executions never receive the owner's private profile or old versions. */
const visibleInSharedExecution = (path: string) =>
  path.startsWith("knowledge/") ||
  path.startsWith("ontology/") ||
  path.startsWith("skills/") ||
  path.startsWith("tools/") ||
  [
    capabilitiesPath,
    "agent/SOUL.md",
    "agent/IDENTITY.md",
    "agent/AGENTS.md",
  ].includes(path);
const visibleToGrant = (path: string, grants: readonly string[] | null) =>
  grants === null ||
  path === capabilitiesPath ||
  (path.startsWith("ontology/")
    ? grants.includes("ontology")
    : grants.includes("files"));
const sharedExecution = (actor: z.output<typeof WorkspaceActorSchema>) =>
  !!(actor.agentGrantId ?? actor.groupBindingId);
const snapshot = async function (workspaceId: string) {
  const rows = await query(
    sql`SELECT head_sha AS head, bundle FROM workspace_repository WHERE workspace_id = ${workspaceId}`
  );
  return rows[0] ? await repositorySchema.parseAsync(rows[0]) : null;
};
const replay = async function (
  workspaceId: string,
  operationId: string,
  hash: string
) {
  const rows = await query<{
    revision: string;
    request_hash: string;
  }>(sql`SELECT revision, request_hash
      FROM workspace_revision WHERE workspace_id = ${workspaceId} AND operation_id = ${operationId}`);
  const previous = rows[0];
  if (previous && previous.request_hash !== hash)
    throw new WorkspaceRepositoryError({
      reason: "conflict",
    });
  return previous?.revision ?? null;
};
export const WorkspaceRepository = {
  selection: async function (
    actor: z.output<typeof WorkspaceActorSchema>,
    paths: readonly string[]
  ) {
    try {
      return await withDatabaseTransaction(async () => {
        await requireWorkspaceAccess(actor);
        const grants = actor.agentGrantId
          ? await readAgentGrantCapabilities(actor)
          : null;
        const stored = await snapshot(actor.workspaceId);
        if (!stored)
          return {
            revision: null,
            documents: [],
          };
        const listing = await readWorkspaceGit(stored.bundle, stored.head);
        const documents = await readWorkspaceGitSelection(
          stored.bundle,
          stored.head,
          paths.filter(
            (path) =>
              listing.files.includes(path) &&
              visibleToGrant(path, grants) &&
              (!sharedExecution(actor) || visibleInSharedExecution(path))
          )
        );
        return {
          revision: stored.head,
          documents,
        };
      });
    } catch (error) {
      if (error instanceof SqlError || error instanceof SchemaError) {
        return unavailable();
      }
      throw error;
    }
  },
  search: async function (
    actor: z.output<typeof WorkspaceActorSchema>,
    localQuery: string
  ) {
    try {
      return await withDatabaseTransaction(async () => {
        await requireWorkspaceAccess(actor);
        const grants = actor.agentGrantId
          ? await readAgentGrantCapabilities(actor)
          : null;
        const stored = await snapshot(actor.workspaceId);
        if (!stored)
          return {
            revision: null,
            matches: [],
          };
        return {
          revision: stored.head,
          matches:
            grants !== null && !grants.includes("files")
              ? []
              : await searchWorkspaceGit(
                  stored.bundle,
                  stored.head,
                  localQuery
                ),
        };
      });
    } catch (error) {
      if (error instanceof SqlError || error instanceof SchemaError) {
        return unavailable();
      }
      throw error;
    }
  },
  read: async function (
    actor: z.output<typeof WorkspaceActorSchema>,
    path?: string,
    revision?: string
  ) {
    try {
      return await withDatabaseTransaction(async () => {
        await requireWorkspaceAccess(actor);
        const grants = actor.agentGrantId
          ? await readAgentGrantCapabilities(actor)
          : null;
        const stored = await snapshot(actor.workspaceId);
        if (!stored) {
          const files: string[] = [];
          return {
            revision: null,
            content: null,
            files,
          };
        }
        const sha = revision ?? stored.head;
        if (
          sharedExecution(actor) &&
          (sha !== stored.head ||
            (path !== undefined &&
              (!visibleInSharedExecution(path) ||
                !visibleToGrant(path, grants))))
        )
          throw new WorkspaceAccessDenied();
        const published =
          await query(sql`SELECT revision FROM workspace_revision
          WHERE workspace_id = ${actor.workspaceId} AND revision = ${sha}`);
        if (published.length !== 1)
          throw new WorkspaceRepositoryError({
            reason: "not_found",
          });
        const listing = await readWorkspaceGit(stored.bundle, sha);
        if (path !== undefined && !listing.files.includes(path))
          throw new WorkspaceRepositoryError({
            reason: "not_found",
          });
        const value =
          path === undefined
            ? listing
            : await readWorkspaceGit(stored.bundle, sha, path);
        return {
          revision: sha,
          ...value,
          files: value.files.filter(
            (filename) =>
              visibleToGrant(filename, grants) &&
              (!sharedExecution(actor) || visibleInSharedExecution(filename))
          ),
        };
      });
    } catch (error) {
      if (error instanceof SqlError || error instanceof SchemaError) {
        return unavailable();
      }
      throw error;
    }
  },
  history: async function (
    actor: z.output<typeof WorkspaceActorSchema>,
    path: string
  ) {
    try {
      return await withDatabaseTransaction(async () => {
        if (sharedExecution(actor)) throw new WorkspaceAccessDenied();
        await requireWorkspaceAccess(actor);
        const filename = await WorkspacePathSchema.parseAsync(path);
        const rows =
          await query(sql`SELECT revision, parent_revision AS parent, path, author_user_id AS author,
          created_at::text AS "createdAt", source FROM workspace_revision
          WHERE workspace_id = ${actor.workspaceId} AND path = ${filename} ORDER BY created_at DESC, revision DESC LIMIT 50`);
        return await z.array(revisionSchema).parseAsync(rows);
      });
    } catch (error) {
      if (error instanceof SqlError || error instanceof SchemaError) {
        return unavailable();
      }
      throw error;
    }
  },
  export: async function (actor: z.output<typeof WorkspaceActorSchema>) {
    try {
      return await withDatabaseTransaction(async () => {
        if (sharedExecution(actor)) throw new WorkspaceAccessDenied();
        await requireWorkspaceAccess(actor);
        return await snapshot(actor.workspaceId);
      });
    } catch (error) {
      if (error instanceof SqlError || error instanceof SchemaError) {
        return unavailable();
      }
      throw error;
    }
  },
  source: async function (
    actor: z.output<typeof WorkspaceActorSchema>,
    revision: string
  ) {
    try {
      return await withDatabaseTransaction(async () => {
        if (sharedExecution(actor)) throw new WorkspaceAccessDenied();
        await requireWorkspaceAccess(actor);
        const sha = await GitRevisionSchema.parseAsync(revision);
        const rows =
          await query(sql`SELECT filename, content AS bytes FROM workspace_source
          WHERE workspace_id = ${actor.workspaceId} AND revision = ${sha}`);
        if (!rows[0])
          throw new WorkspaceRepositoryError({
            reason: "not_found",
          });
        return await importSourceSchema.parseAsync(rows[0]);
      });
    } catch (error) {
      if (error instanceof SqlError || error instanceof SchemaError) {
        return unavailable();
      }
      throw error;
    }
  },
  write: async function (
    actor: z.output<typeof WorkspaceActorSchema>,
    raw: z.output<typeof WorkspaceWriteSchema>,
    source:
      | {
          readonly kind: "editor" | "agent";
        }
      | {
          readonly kind: "ontology";
          readonly action?: Pick<
            z.output<typeof OntologyActionSchema>,
            "actionId" | "entityId"
          >;
        }
      | {
          readonly kind: "import";
          readonly filename: string;
          readonly bytes: Uint8Array;
        }
      | {
          readonly kind: "publication" | "tool-publication";
          readonly proposal: string;
        }
      | {
          readonly kind: "rollback" | "tool-rollback";
          readonly revision: string;
        }
      | {
          readonly kind: "tool-disable";
        } = {
      kind: "editor",
    }
  ) {
    try {
      if (
        actor.agentGrantId ||
        (raw.path === ontologyPath && source.kind !== "ontology")
      )
        throw new WorkspaceAccessDenied();
      const input = await Promise.try(async () =>
        WorkspaceWriteSchema.parseAsync(raw)
      ).catch(() => {
        throw new WorkspaceRepositoryError({
          reason: "invalid_input",
        });
      });
      if (
        isValid(PublishedToolPath, input.path) &&
        !["tool-publication", "tool-rollback", "tool-disable"].includes(
          source.kind
        )
      )
        throw new WorkspaceAccessDenied();
      if (
        (isValid(PublishedToolPath, input.path) ||
          isValid(ToolProposalPath, input.path)) &&
        input.content !== null
      )
        await decodeCustomerTool(input.content);
      if (
        source.kind === "tool-publication" &&
        (!isValid(ToolProposalPath, source.proposal) ||
          source.proposal.replace(/^proposals\//u, "") !== input.path)
      )
        throw new WorkspaceRepositoryError({
          reason: "invalid_input",
        });
      if (
        source.kind === "tool-rollback" &&
        (!isValid(PublishedToolPath, input.path) ||
          !isValid(GitRevisionSchema, source.revision))
      )
        throw new WorkspaceRepositoryError({
          reason: "invalid_input",
        });
      if (
        source.kind === "tool-disable" &&
        (!isValid(PublishedToolPath, input.path) || input.content !== null)
      )
        throw new WorkspaceRepositoryError({
          reason: "invalid_input",
        });
      if (input.path === capabilitiesPath && input.content !== null)
        await jsonString(WorkspaceCapabilitiesSchema.strict()).parseAsync(
          input.content
        );
      if (isSkillContentPath(input.path) && input.content !== null)
        await Promise.try(async () =>
          SkillDocumentSchema.parseAsync(input.content)
        ).catch(() => {
          throw new WorkspaceRepositoryError({
            reason: "invalid_input",
          });
        });
      if (source.kind === "publication") {
        if (
          !isValid(SkillProposalPath, source.proposal) ||
          skillPathFromProposal(source.proposal) !== input.path
        )
          throw new WorkspaceRepositoryError({
            reason: "invalid_input",
          });
      }
      if (
        source.kind === "rollback" &&
        (!isValid(PublishedSkillPath, input.path) ||
          !isValid(GitRevisionSchema, source.revision))
      )
        throw new WorkspaceRepositoryError({
          reason: "invalid_input",
        });
      if (
        (input.path.startsWith("agent/") || isSkillContentPath(input.path)) &&
        (input.content?.length ?? 0) > 16_000
      )
        throw new WorkspaceRepositoryError({
          reason: "invalid_input",
        });
      const original =
        source.kind === "import"
          ? await importSourceSchema.parseAsync(source)
          : null;
      const sourceSha =
        original === null
          ? null
          : createHash("sha256").update(original.bytes).digest("hex");
      const hash = createHash("sha256")
        .update(
          JSON.stringify({
            userId: actor.userId,
            input,
            source: {
              kind: source.kind,
              sha256: sourceSha,
              filename: original?.filename,
              action: source.kind === "ontology" ? source.action : undefined,
              proposal:
                ["publication", "tool-publication"].includes(source.kind) &&
                "proposal" in source
                  ? source.proposal
                  : undefined,
              revision:
                ["rollback", "tool-rollback"].includes(source.kind) &&
                "revision" in source
                  ? source.revision
                  : undefined,
            },
          })
        )
        .digest("hex");
      const initial = await withDatabaseTransaction(async () => {
        await requireWorkspaceAccess(
          actor,
          !input.path.startsWith("knowledge/") &&
            !input.path.startsWith("proposals/skills/") &&
            !input.path.startsWith("proposals/tools/")
        );
        const prior = await replay(actor.workspaceId, input.operationId, hash);
        return {
          prior,
          stored: await snapshot(actor.workspaceId),
        };
      });
      if (initial.prior)
        return {
          revision: initial.prior,
        };
      if ((initial.stored?.head ?? null) !== input.expectedRevision)
        throw new WorkspaceRepositoryError({
          reason: "conflict",
        });
      const metadata =
        source.kind === "ontology"
          ? {
              actor: actor.userId,
              operation: input.operationId,
              action: source.action,
            }
          : source.kind === "publication" || source.kind === "tool-publication"
            ? {
                actor: actor.userId,
                operation: input.operationId,
                source: "publication",
                proposal: source.proposal,
              }
            : source.kind === "rollback" || source.kind === "tool-rollback"
              ? {
                  actor: actor.userId,
                  operation: input.operationId,
                  source: "rollback",
                  revision: source.revision,
                }
              : {
                  actor: actor.userId,
                  operation: input.operationId,
                };
      const gitInput = {
        bundle: initial.stored?.bundle ?? null,
        parent: input.expectedRevision,
        path: input.path,
        content: input.content,
        message: `${input.content === null ? "Remove" : "Update"} ${input.path}\n\nZoen-Metadata: ${JSON.stringify(metadata)}`,
      };
      const candidate = await publishWorkspaceGit(
        source.kind === "publication" || source.kind === "tool-publication"
          ? {
              ...gitInput,
              remove: source.proposal,
            }
          : gitInput
      );
      return await withDatabaseTransaction(async () => {
        await requireWorkspaceAccess(
          actor,
          !input.path.startsWith("knowledge/") &&
            !input.path.startsWith("proposals/skills/") &&
            !input.path.startsWith("proposals/tools/")
        );
        const prior = await replay(actor.workspaceId, input.operationId, hash);
        if (prior)
          return {
            revision: prior,
          };
        const published =
          await query(sql`INSERT INTO workspace_repository (workspace_id, head_sha, bundle)
            VALUES (${actor.workspaceId}, ${candidate.revision}, ${candidate.bundle})
            ON CONFLICT (workspace_id) DO UPDATE SET head_sha = EXCLUDED.head_sha,
              bundle = EXCLUDED.bundle, updated_at = clock_timestamp()
              WHERE workspace_repository.head_sha = ${input.expectedRevision}
            RETURNING head_sha`);
        if (published.length !== 1) {
          const racedReplay = await replay(
            actor.workspaceId,
            input.operationId,
            hash
          );
          if (racedReplay)
            return {
              revision: racedReplay,
            };
          throw new WorkspaceRepositoryError({
            reason: "conflict",
          });
        }
        await query(sql`INSERT INTO workspace_revision (workspace_id, revision, parent_revision, operation_id,
            request_hash, path, author_user_id, source, source_sha256)
            VALUES (${actor.workspaceId}, ${candidate.revision}, ${input.expectedRevision}, ${input.operationId},
              ${hash}, ${input.path}, ${actor.userId}, ${source.kind}, ${sourceSha})`);
        if (original !== null) {
          const totals = await query<{
            bytes: number;
          }>(sql`SELECT coalesce(sum(octet_length(content)), 0)::int AS bytes
              FROM workspace_source WHERE workspace_id = ${actor.workspaceId}`);
          if ((totals[0]?.bytes ?? 0) + original.bytes.length > 104_857_600)
            throw new WorkspaceRepositoryError({
              reason: "invalid_input",
            });
          await query(sql`INSERT INTO workspace_source (workspace_id, revision, filename, content)
              VALUES (${actor.workspaceId}, ${candidate.revision}, ${original.filename}, ${original.bytes})`);
        }
        return {
          revision: candidate.revision,
        };
      });
    } catch (error) {
      if (error instanceof SqlError || error instanceof SchemaError) {
        return unavailable();
      }
      throw error;
    }
  },
};
