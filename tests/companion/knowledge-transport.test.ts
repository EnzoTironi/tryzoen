import { expect, test, vi } from "vitest";
import { companionOntologyData } from "../../shared/companion/knowledge";
import { ontologyPath } from "@zoen/companion-ui/ontology";

const revision = "a".repeat(40);

test("ontology history and recorded source reads use the existing document owner", async () => {
  const query = vi.fn<(path: string, raw?: unknown) => Promise<unknown>>(
    async (path) => {
      if (path === "workspaces.history")
        return [
          {
            revision,
            parent: null,
            path: ontologyPath,
            author: "synthetic",
            createdAt: "2026-09-29T00:00:00Z",
            source: "knowledge-publication",
          },
        ];
      return {
        revision,
        content: "Recorded passage",
        files: ["knowledge/source.md"],
        canEdit: false,
      };
    }
  );
  const data = companionOntologyData(
    { query, mutation: vi.fn<() => Promise<unknown>>() },
    "session:workspace",
    () => "00000000-0000-4000-8000-000000000001",
    () => undefined
  );
  expect(await data.history()).toMatchObject([
    { revision, source: "knowledge-publication" },
  ]);
  expect(query).toHaveBeenCalledWith("workspaces.history", {
    path: ontologyPath,
  });
  expect(
    await data.source({
      path: "knowledge/source.md",
      revision,
      excerpt: "Recorded passage",
    })
  ).toBe("Recorded passage");
  expect(query).toHaveBeenCalledWith("workspaces.files", {
    path: "knowledge/source.md",
    revision,
  });
});
