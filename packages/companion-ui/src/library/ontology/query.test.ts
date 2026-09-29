import { QueryClient } from "@tanstack/react-query";
import { expect, test, vi } from "vitest";
import type { z } from "zod";
import { ontologyReadOptions } from "./query";
import {
  emptyOntology,
  OntologyReadSchema,
  type OntologyReadResultSchema,
} from "./schema";

const revision = "a".repeat(40);

test("knowledge caches keep different principals, recorded versions and validity dates separate", async () => {
  const query = vi.fn<
    (
      path: string,
      raw?: unknown
    ) => Promise<z.output<typeof OntologyReadResultSchema>>
  >(async (_path, raw) => {
    const input = OntologyReadSchema.parse(raw);
    return {
      graph: emptyOntology,
      revision: input.revision ?? "b".repeat(40),
      validOn: input.validOn ?? null,
      sourceCheckedAtRevision: "b".repeat(40),
      sources: [],
      mayManage: false,
    };
  });
  const rpc = { query };
  const owner = {
    cacheKey: ["ontology", "owner-session:workspace"],
    read: (input: z.output<typeof OntologyReadSchema>) =>
      rpc.query("workspaces.ontology.read", input),
    source: async () => null,
    history: async () => [],
  };
  const guest = { ...owner, cacheKey: ["ontology", "guest-session:workspace"] };
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  try {
    const view = { revision, validOn: "2026-09-01" };
    const first = await cache.query(ontologyReadOptions(owner, view));
    expect(await cache.query(ontologyReadOptions(owner, view))).toBe(first);
    expect(query).toHaveBeenCalledExactlyOnceWith(
      "workspaces.ontology.read",
      view
    );
    expect(
      await cache.query(
        ontologyReadOptions(owner, { ...view, validOn: "2026-10-01" })
      )
    ).toMatchObject({ validOn: "2026-10-01" });
    await cache.query(ontologyReadOptions(guest, view));
    expect(await cache.query(ontologyReadOptions(owner, {}))).toMatchObject({
      revision: "b".repeat(40),
      validOn: null,
    });
    expect(query).toHaveBeenCalledTimes(4);
  } finally {
    cache.clear();
  }
});
