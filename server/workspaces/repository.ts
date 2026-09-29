import {
  GitRevisionSchema,
  WorkspacePathSchema,
  workspaceRevisionSchema,
  WorkspaceChangeSchema,
  WorkspacePublishSchema,
} from "@zoen/companion-ui/workspace-files";
import {
  knowledgeProposalPathSchema,
  knowledgeProposalSchema,
  knowledgePathSchema,
  knowledgeRoutingPath,
  knowledgeRoutingSchema,
} from "@zoen/companion-ui/knowledge";
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
  publishWorkspaceGit,
  WorkspaceGitError,
  readWorkspaceGit,
  readWorkspaceGitSelection,
  searchWorkspaceGit,
} from "./git";
import {
  isSkillContentPath,
  PublishedSkillPath,
  SkillDocumentSchema,
  SkillProposalPath,
  skillPathFromProposal,
} from "./skill-document";
export const WorkspaceWriteSchema = WorkspacePublishSchema.omit({
  changes: true,
}).extend(WorkspaceChangeSchema.shape);

type WorkspacePublicationSource =
  | { readonly kind: "editor" | "agent" }
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
      readonly kind:
        | "publication"
        | "tool-publication"
        | "knowledge-publication";
      readonly proposal: string;
    }
  | { readonly kind: "rollback" | "tool-rollback"; readonly revision: string }
  | { readonly kind: "tool-disable" | "knowledge-rejection" };

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
async function validateKnowledgeChange(
  input: z.output<typeof WorkspaceChangeSchema>,
  source: WorkspacePublicationSource
) {
  if (
    source.kind === "agent" &&
    (input.path === "knowledge/purpose.md" ||
      /^knowledge\/(?:models|definitions|routing)\//u.test(input.path))
  )
    throw new WorkspaceAccessDenied();
  if (input.path === knowledgeRoutingPath && input.content !== null)
    await jsonString(knowledgeRoutingSchema).parseAsync(input.content);
  if (isValid(knowledgeProposalPathSchema, input.path)) {
    // Drafts are created by the proposal tool and resolved by the reviewer.
    // The generic editor cannot bypass review by deleting or replacing a draft.
    if (source.kind !== "agent" && source.kind !== "knowledge-rejection")
      throw new WorkspaceAccessDenied();
    if (source.kind === "agent" && input.content === null)
      throw new WorkspaceAccessDenied();
    if (input.content !== null)
      await jsonString(knowledgeProposalSchema).parseAsync(input.content);
  }
  if (
    source.kind === "knowledge-publication" &&
    (!isValid(knowledgeProposalPathSchema, source.proposal) ||
      !isValid(knowledgePathSchema, input.path))
  )
    throw new WorkspaceRepositoryError({ reason: "invalid_input" });
  if (
    source.kind === "knowledge-rejection" &&
    (!isValid(knowledgeProposalPathSchema, input.path) ||
      input.content !== null)
  )
    throw new WorkspaceRepositoryError({ reason: "invalid_input" });
}

async function validateWorkspaceChange(
  input: z.output<typeof WorkspaceChangeSchema>,
  source: WorkspacePublicationSource
) {
  await validateKnowledgeChange(input, source);
  if (input.path === ontologyPath && source.kind !== "ontology")
    throw new WorkspaceAccessDenied();
  if (
    isValid(PublishedToolPath, input.path) &&
    !["tool-publication", "tool-rollback", "tool-disable"].includes(source.kind)
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
}

export const WorkspaceRepository = {
  selection: async function (
    actor: z.output<typeof WorkspaceActorSchema>,
    paths: readonly string[],
    revision?: string
  ) {
    try {
      return await withDatabaseTransaction(async () => {
        await requireWorkspaceAccess(actor);
        const grants = actor.agentGrantId
          ? await readAgentGrantCapabilities(actor)
          : null;
        const stored = await snapshot(actor.workspaceId);
        if (revision !== undefined && sharedExecution(actor))
          throw new WorkspaceAccessDenied();
        if (!stored) {
          if (revision !== undefined)
            throw new WorkspaceRepositoryError({ reason: "not_found" });
          return {
            revision: null,
            documents: [],
          };
        }
        const sha =
          revision === undefined
            ? stored.head
            : await GitRevisionSchema.parseAsync(revision);
        if (revision !== undefined) {
          const published =
            await query(sql`SELECT revision FROM workspace_revision
            WHERE workspace_id = ${actor.workspaceId} AND revision = ${sha}`);
          if (!published.length)
            throw new WorkspaceRepositoryError({ reason: "not_found" });
        }
        const listing = await readWorkspaceGit(stored.bundle, sha);
        const documents = await readWorkspaceGitSelection(
          stored.bundle,
          sha,
          paths.filter(
            (path) =>
              listing.files.includes(path) &&
              visibleToGrant(path, grants) &&
              (!sharedExecution(actor) || visibleInSharedExecution(path))
          )
        );
        return {
          revision: sha,
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
          if (revision !== undefined)
            throw new WorkspaceRepositoryError({ reason: "not_found" });
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
          await query(sql`SELECT revision, parent_revision AS parent, ${filename}::text AS path, author_user_id AS author,
          created_at::text AS "createdAt", source FROM workspace_revision
          WHERE workspace_id = ${actor.workspaceId} AND ${filename} = ANY(paths) ORDER BY created_at DESC, revision DESC LIMIT 50`);
        return await z.array(workspaceRevisionSchema).parseAsync(rows);
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
    source: WorkspacePublicationSource = { kind: "editor" }
  ) {
    const input = await WorkspaceWriteSchema.parseAsync(raw);
    return WorkspaceRepository.publish(
      actor,
      {
        operationId: input.operationId,
        expectedRevision: input.expectedRevision,
        changes: [{ path: input.path, content: input.content }],
      },
      source
    );
  },
  publish: async function (
    actor: z.output<typeof WorkspaceActorSchema>,
    raw: z.output<typeof WorkspacePublishSchema>,
    source: WorkspacePublicationSource = { kind: "editor" }
  ) {
    try {
      if (actor.agentGrantId) throw new WorkspaceAccessDenied();
      const input = await WorkspacePublishSchema.parseAsync(raw).catch(() => {
        throw new WorkspaceRepositoryError({ reason: "invalid_input" });
      });
      // Existing specialized publishers own ontology, tools and skills. Multi-file
      // publication cannot be used to bypass their policy or validation.
      if (
        input.changes.length > 1 &&
        !input.changes.every(({ path }) => path.startsWith("knowledge/"))
      )
        throw new WorkspaceAccessDenied();
      for (const change of input.changes)
        await validateWorkspaceChange(change, source);
      const admin =
        source.kind === "knowledge-publication" ||
        source.kind === "knowledge-rejection" ||
        input.changes.some(
          ({ path }) =>
            !path.startsWith("knowledge/") &&
            !path.startsWith("proposals/skills/") &&
            !path.startsWith("proposals/tools/") &&
            !path.startsWith("proposals/knowledge/")
        );
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
                [
                  "publication",
                  "tool-publication",
                  "knowledge-publication",
                ].includes(source.kind) && "proposal" in source
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
        await requireWorkspaceAccess(actor, admin);
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
          : source.kind === "publication" ||
              source.kind === "tool-publication" ||
              source.kind === "knowledge-publication"
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
      const changes =
        source.kind === "publication" ||
        source.kind === "tool-publication" ||
        source.kind === "knowledge-publication"
          ? [...input.changes, { path: source.proposal, content: null }]
          : input.changes;
      const candidate = await publishWorkspaceGit({
        bundle: initial.stored?.bundle ?? null,
        parent: input.expectedRevision,
        changes,
        message: `Update ${input.changes.map(({ path }) => path).join(", ")}\n\nZoen-Metadata: ${JSON.stringify(metadata)}`,
      });
      if (
        input.changes.some((change) => change.path.startsWith("knowledge/"))
      ) {
        const tree = await readWorkspaceGit(
          candidate.bundle,
          candidate.revision
        );
        if (tree.files.includes(knowledgeRoutingPath)) {
          const index = await readWorkspaceGit(
            candidate.bundle,
            candidate.revision,
            knowledgeRoutingPath
          );
          const routing = jsonString(knowledgeRoutingSchema).parse(
            index.content
          );
          if (
            routing.records.some((record) =>
              record.paths.some((path) => !tree.files.includes(path))
            )
          )
            throw new WorkspaceRepositoryError({ reason: "invalid_input" });
        }
      }
      return await withDatabaseTransaction(async () => {
        await requireWorkspaceAccess(actor, admin);
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
            request_hash, paths, author_user_id, source, source_sha256)
            VALUES (${actor.workspaceId}, ${candidate.revision}, ${input.expectedRevision}, ${input.operationId},
              ${hash}, ARRAY[${sql.join(
                changes.map(({ path }) => sql`${path}`),
                sql`, `
              )}]::text[], ${actor.userId}, ${source.kind}, ${sourceSha})`);
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
      if (error instanceof WorkspaceGitError && error.reason !== "unavailable")
        throw new WorkspaceRepositoryError({ reason: "invalid_input" });
      if (
        error instanceof SqlError ||
        error instanceof SchemaError ||
        error instanceof WorkspaceGitError
      ) {
        return unavailable();
      }
      throw error;
    }
  },
};
