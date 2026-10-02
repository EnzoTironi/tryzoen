import { createHmac, randomUUID } from "node:crypto";
import type { ServerResponse } from "node:http";
import { createHTTPServer } from "@trpc/server/adapters/standalone";
import { createTRPCUntypedClient, httpLink } from "@trpc/client";
import { expect, test } from "vitest";
import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import { getInstallationSecrets } from "@db/services/installation-secrets";
import { appRouter } from "../../web/trpc/router";
import { resolveWorkspaceActor } from "../../server/workspaces/session";
import { publishOntology } from "../../server/workspaces/ontology";
import { emptyOntology } from "@zoen/companion-ui/ontology";
import { companionOntologyData } from "../../shared/companion/knowledge";
import {
  beginOntologyAction,
  ontologyActionInput,
} from "../../packages/companion-ui/src/library/ontology/action-draft";
import { workspaceFixture } from "./workspace-fixture";

// The real router, cookie/session owner and PostgreSQL/Git publisher run here.
// The peer can close its actual socket after execution to lose one response.
async function ontologyRPCPeer() {
  let loseResponse = false;
  let response: ServerResponse | undefined;
  const server = createHTTPServer({
    router: appRouter,
    basePath: "/api/trpc/",
    async createContext({ req, res }) {
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (value !== undefined)
          headers.set(key, Array.isArray(value) ? value.join(", ") : value);
      }
      const actor = await resolveWorkspaceActor(headers);
      response = res;
      return {
        requestHeaders: headers,
        scope: { userId: actor.userId, workspaceId: actor.workspaceId },
      };
    },
    responseMeta() {
      if (loseResponse) {
        loseResponse = false;
        response?.destroy();
      }
      return { headers: { "cache-control": "private, no-store" } };
    },
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing loopback RPC address");
  const url = `http://127.0.0.1:${address.port}/api/trpc`;
  return {
    url,
    loseNextResponse() {
      loseResponse = true;
    },
    async [Symbol.asyncDispose]() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    },
  };
}

async function ontologyClient(
  url: string,
  actor: Awaited<ReturnType<typeof workspaceFixture>>["actor" | "guest"]
) {
  const { betterAuthSecret } = await getInstallationSecrets();
  const signature = createHmac("sha256", betterAuthSecret)
    .update(actor.authSessionId)
    .digest("base64");
  const rpc = createTRPCUntypedClient({
    links: [
      httpLink({
        url,
        headers: {
          cookie: `better-auth.session_token=${encodeURIComponent(`${actor.authSessionId}.${signature}`)}`,
          "x-zoen-workspace": actor.workspaceId,
        },
      }),
    ],
  });
  return companionOntologyData(
    rpc,
    `${actor.authSessionId}:${actor.workspaceId}`,
    randomUUID,
    () => undefined
  );
}

test("real ontology RPC resolves a lost response by replaying one frozen action and reports CAS and authorization honestly", async () => {
  await using workspace = await workspaceFixture();
  await using peer = await ontologyRPCPeer();
  const { actor, guest, repository } = workspace;
  const source = await repository.write(actor, {
    operationId: randomUUID(),
    expectedRevision: null,
    path: "knowledge/project.md",
    content: "Planned then active during September.",
  });
  const claim = {
    value: "planned",
    sources: [
      {
        path: "knowledge/project.md",
        revision: source.revision,
        excerpt: "Planned then active during September.",
      },
    ],
    validTime: { from: "2026-09-01", until: "2026-10-01" },
  };
  const published = await publishOntology(actor, {
    operationId: randomUUID(),
    expectedRevision: source.revision,
    graph: {
      ...emptyOntology,
      entities: [
        {
          id: "one",
          type: "project",
          name: "Synthetic project",
          properties: { status: claim },
          sources: [],
        },
      ],
    },
  });
  const data = await ontologyClient(peer.url, actor);
  const captured = await data.read({});
  const draft = beginOntologyAction(captured, "one", "project_status");
  if (!draft) throw new Error("Missing authorized action");
  const input = ontologyActionInput(
    { ...draft, value: "active" },
    data.operationId()
  );
  peer.loseNextResponse();
  await expect(data.act(input)).rejects.toThrow(
    /fetch failed|other side closed|socket|interrupted|network|Failed to fetch/iu
  );
  const changed = await data.act(input);
  expect(await data.act(input)).toEqual(changed);
  expect((await data.read({})).graph.entities[0]?.properties.status).toEqual({
    ...claim,
    value: "active",
  });
  expect(
    (await data.read({ revision: published.revision })).graph.entities[0]
      ?.properties.status
  ).toEqual(claim);
  const receipts = await query<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM workspace_revision WHERE workspace_id = ${actor.workspaceId} AND operation_id = ${input.operationId}`
  );
  expect(receipts[0]?.n).toBe(1);
  await expect(data.act({ ...input, value: "altered" })).rejects.toMatchObject({
    data: { code: "CONFLICT" },
  });
  await expect(
    data.act({ ...input, operationId: randomUUID(), value: "stale" })
  ).rejects.toMatchObject({ data: { code: "CONFLICT" } });
  const member = await ontologyClient(peer.url, guest);
  expect((await member.read({})).mayManage).toBe(false);
  await expect(
    member.act({
      ...input,
      operationId: randomUUID(),
      expectedRevision: changed.revision,
    })
  ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
  expect((await data.read({})).revision).toBe(changed.revision);
});
