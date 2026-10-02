import { lstat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { sql } from "drizzle-orm";
import { query, transaction } from "@db/queries";
import { env } from "@shared/environment/env";
import { memoryNamespace } from "../../server/memory/namespace";
import { workspaceFixture } from "./workspace-fixture";
import { requireRuntimeDatabase } from "./database";

/** Real configuration and files, with no environment/module replacement. The
 * runner creates a fresh private /tmp/zoen-k3-* root before loading the app. */
export async function privateMemoryFixture() {
  await requireRuntimeDatabase();
  const root = env.ZOEN_SESSION_ARCHIVE_DIR;
  if (!root || !resolve(root).startsWith(join(resolve(tmpdir()), "zoen-k3-")))
    throw new Error(
      "K3 memory runtime proof requires a fresh private /tmp/zoen-k3-* ZOEN_SESSION_ARCHIVE_DIR"
    );
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0)
    throw new Error("K3 runtime archive root must be a private real directory");
  const fixture = await workspaceFixture();
  const namespaces = new Set<string>();
  return {
    ...fixture,
    root,
    async namespace(actor: Parameters<typeof memoryNamespace>[0]) {
      const namespace = await transaction(() => memoryNamespace(actor));
      namespaces.add(namespace.id);
      return namespace;
    },
    async [Symbol.asyncDispose]() {
      try {
        const rows = await query<{
          id: string;
        }>(sql`SELECT namespace_id AS id FROM workspace_memory_namespace
          WHERE workspace_id IN (${fixture.actor.workspaceId},${fixture.personal.workspaceId},${fixture.guestPersonal.workspaceId})`);
        for (const row of rows) namespaces.add(row.id);
      } finally {
        try {
          await fixture[Symbol.asyncDispose]();
        } finally {
          for (const id of namespaces) {
            await rm(join(root, id), { recursive: true, force: true });
            await query(
              sql`DELETE FROM workspace_memory_erasure WHERE namespace_id=${id}`
            );
          }
        }
      }
    },
  };
}
