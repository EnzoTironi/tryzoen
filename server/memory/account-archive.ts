import { query, transaction } from "@db/queries";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { GitRevisionSchema } from "../../packages/companion-ui/src/library/files-schema";
import type { LearnedClaimBodySchema } from "../../packages/companion-ui/src/learned/claim";
import {
  archivedPrivateNamespace,
  AccountMemoryArchiveUnavailable,
} from "../accounts/archive-entitlement";
import { readPrivateMemoryGit } from "./git";
import { readWorkspaceGitSelection } from "../workspaces/git";
import {
  verifyArchivedSessionClaimSource,
  backupArchivedCompleteSessionSources,
} from "./session-export";
import {
  PrivateMemoryCorpusBackupSchema,
  sealPrivateMemoryArchive,
} from "./archive";

async function capturedArchiveMemory(
  owner: Awaited<ReturnType<typeof archivedPrivateNamespace>>
) {
  if (!owner.namespace) return null;
  const [row] =
    await query(sql`SELECT head_sha AS head, bundle FROM private_memory_repository
    WHERE namespace_id=${owner.namespace.id}`);
  if (!row) throw new AccountMemoryArchiveUnavailable();
  const repository = z
    .object({
      head: GitRevisionSchema.nullable(),
      bundle: z.instanceof(Uint8Array).nullable(),
    })
    .parse(row);
  if (repository.head === null) {
    const [receipt] = await query(
      sql`SELECT revision FROM private_memory_operation WHERE namespace_id=${owner.namespace.id} LIMIT 1`
    );
    if (receipt) throw new AccountMemoryArchiveUnavailable();
  }
  const captured = await readPrivateMemoryGit({
    scope: owner.scope,
    ...repository,
    includeRetainedSources: true,
  });
  return { ...captured, repository };
}

async function verifyArchiveEvidence(
  headers: Headers,
  archiveId: string,
  owner: Awaited<ReturnType<typeof archivedPrivateNamespace>>,
  sources: z.infer<typeof LearnedClaimBodySchema>["sources"]
) {
  for (const source of sources) {
    if (source.kind === "session") {
      if (!(await verifyArchivedSessionClaimSource(headers, archiveId, source)))
        throw new AccountMemoryArchiveUnavailable();
      continue;
    }
    const [row] = await query(
      sql`SELECT bundle FROM workspace_repository WHERE workspace_id=${owner.scope.workspaceId} FOR SHARE`
    );
    const repository = row
      ? z.object({ bundle: z.instanceof(Uint8Array) }).parse(row)
      : null;
    if (!repository) throw new AccountMemoryArchiveUnavailable();
    const selected = await readWorkspaceGitSelection(
      repository.bundle,
      source.revision,
      [source.path]
    );
    if (
      !selected
        .find((document) => document.path === source.path)
        ?.content.includes(source.excerpt)
    )
      throw new AccountMemoryArchiveUnavailable();
  }
}

/** Export-only authority. No target recall or source-principal impersonation. */
export async function readArchivedPrivateMemory(
  headers: Headers,
  archiveId: string
) {
  return transaction(async () => {
    const owner = await archivedPrivateNamespace(headers, archiveId);
    const captured = await capturedArchiveMemory(owner);
    if (!captured) return null;
    await verifyArchiveEvidence(
      headers,
      archiveId,
      owner,
      captured.snapshot.claims.flatMap((claim) =>
        claim.file.state.kind === "active" ? claim.file.state.body.sources : []
      )
    );
    await archivedPrivateNamespace(headers, archiveId);
    return captured.snapshot;
  });
}

export async function backupArchivedPrivateMemory(
  headers: Headers,
  archiveId: string
) {
  return transaction(async () => {
    const owner = await archivedPrivateNamespace(headers, archiveId);
    const captured = await capturedArchiveMemory(owner);
    if (!captured || !owner.namespace)
      throw new AccountMemoryArchiveUnavailable();
    await verifyArchiveEvidence(
      headers,
      archiveId,
      owner,
      captured.retainedSources
    );
    const journal = await backupArchivedCompleteSessionSources(
      headers,
      archiveId
    );
    await archivedPrivateNamespace(headers, archiveId);
    return PrivateMemoryCorpusBackupSchema.parse(
      sealPrivateMemoryArchive({
        version: 3,
        coverage: "complete-journal",
        ...journal,
        namespaceId: owner.namespace.id,
        scope: owner.scope,
        revision: captured.repository.head,
        bundle:
          captured.repository.bundle === null
            ? null
            : Uint8Array.from(captured.repository.bundle),
      })
    );
  });
}
