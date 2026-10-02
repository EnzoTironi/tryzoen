import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, expect, test, vi } from "vitest";
import { authorizedCreatorCorpus } from "./access";
import { corpusDigest, corpusManifestSchema } from "./schema";
import { WorkspaceAccessDenied } from "../../workspaces/access";

const owners = vi.hoisted(() => ({
  query: vi.fn<(statement: SQL) => Promise<Record<string, unknown>[]>>(),
  release: vi.fn<() => Promise<{ id: string }>>(),
  pilot: vi.fn<() => Promise<{ releaseId: string }>>(),
}));
vi.mock("../../../db/queries", () => ({ query: owners.query }));
vi.mock("../releases", () => ({ readCreatorRelease: owners.release }));
vi.mock("../pilots", () => ({ requireActiveCreatorPilot: owners.pilot }));

const actor = {
  workspaceId: "synthetic-creator-team",
  userId: "better-auth:synthetic-creator-owner",
  authSessionId: "synthetic-creator-session",
};
const namespace = "4c17282b-0436-4fc2-bf59-08d7c8faecbd";
const releaseId = "ed15b2dc-4fcd-477f-9dfa-0e4f166af7f5";
const pilotId = "b895229f-d496-4148-a904-a4d99c95c6b5";
const manifest = corpusManifestSchema.parse({
  version: 1,
  releaseId,
  draftRevision: "2cdc3ad7-6496-4f8b-a382-fab084ff1caf",
  pages: [],
});
const row = {
  namespace,
  manifest,
  digest: corpusDigest(JSON.stringify(manifest)),
  initialized: true,
};
const dialect = new PgDialect();
beforeEach(() => {
  vi.clearAllMocks();
  owners.query.mockReset();
  owners.release.mockResolvedValue({ id: releaseId });
  owners.pilot.mockResolvedValue({ releaseId });
});

for (const kind of ["creator", "pilot"] as const) {
  const access = kind === "creator" ? { kind, releaseId } : { kind, pilotId };
  test(`${kind} corpus refuses any pending namespace erasure before returning content`, async () => {
    owners.query.mockResolvedValueOnce([row]).mockResolvedValueOnce([
      {
        namespace_id: namespace,
        available_at: "2099-01-01T00:00:00Z",
      },
    ]);
    await expect(authorizedCreatorCorpus(actor, access)).rejects.toBeInstanceOf(
      WorkspaceAccessDenied
    );
    expect(owners.query).toHaveBeenCalledTimes(2);
    const statement = owners.query.mock.calls[1]?.[0];
    if (!statement) throw new Error("Expected exact erasure admission query");
    const compiled = dialect.sqlToQuery(statement);
    expect(compiled.params).toEqual([namespace]);
    expect(compiled.sql).not.toMatch(
      /SKIP LOCKED|available_at|FOR (UPDATE|SHARE)/u
    );
  });
  test(`${kind} corpus retains exact approved namespace and authority when no erasure is pending`, async () => {
    owners.query.mockResolvedValueOnce([row]).mockResolvedValueOnce([]);
    await expect(authorizedCreatorCorpus(actor, access)).resolves.toEqual(row);
    expect(owners.query).toHaveBeenCalledTimes(2);
    const first = owners.query.mock.calls[0]?.[0];
    const last = owners.query.mock.calls[1]?.[0];
    if (!first || !last)
      throw new Error("Expected corpus lock then erasure admission");
    expect(dialect.sqlToQuery(first).sql).toContain("FOR UPDATE");
    expect(dialect.sqlToQuery(last).sql).toContain("workspace_memory_erasure");
    expect(dialect.sqlToQuery(last).params).toEqual([namespace]);
  });
}

test("creator access denial precedes corpus or erasure lookup", async () => {
  owners.release.mockRejectedValueOnce(new WorkspaceAccessDenied());
  await expect(
    authorizedCreatorCorpus(actor, { kind: "creator", releaseId })
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  expect(owners.query).not.toHaveBeenCalled();
});
