import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type * as egress from "../../server/connectors/public-fetch";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import {
  connectTools,
  listToolConnections,
  remoteToolDefinition,
  revokeToolConnection,
  toolConnectionCredentials,
} from "../../server/connectors/connections";
import { invokeRemoteTool } from "../../server/connectors/invocation";
import { ConnectorError } from "../../server/connectors/definition";
import {
  decodeCustomerTool,
  customerToolId,
} from "../../server/workspaces/tool-document";
import {
  publishCustomerTool,
  validateCustomerTool,
} from "../../server/workspaces/tools";
import { publishSkillProposal } from "../../server/workspaces/skills";
import {
  callNativeTool,
  nativeContext,
  readNativeSkill,
} from "../helpers/native-tools";
import { resolveCustomerTools } from "../../server/tools/customer-tools";
import { workspaceExecutionFor, workspaceFixture } from "./workspace-fixture";
import { connectorDocument, connectorFixture } from "./connector-fixture";
import { linkedIdentity } from "./identity-fixture";
const endpoint = vi.hoisted(() => ({
  origin: "",
}));
// The service is an actual HTTP fixture. Only the public egress adapter is
// mapped to loopback here; its DNS/TLS enforcement has separate negative tests.
vi.mock("../../server/connectors/public-fetch", async (original) => {
  const actual = await original<typeof egress>();
  return {
    ...actual,
    publicFetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      if (url.hostname !== "connector.zoen.test")
        throw new Error("Unexpected fixture host");
      return fetch(`${endpoint.origin}${url.pathname}${url.search}`, {
        method: request.method,
        headers: request.headers,
        signal: request.signal,
        body: request.body ? await request.text() : undefined,
      });
    },
  };
});
let fixture: Awaited<ReturnType<typeof connectorFixture>>;
beforeAll(async () => {
  fixture = await connectorFixture();
  endpoint.origin = fixture.origin;
});
afterAll(async () => {
  await fixture.close();
});
test.each(["mcp", "mcp-sse", "openapi"] as const)(
  "TL remote %s: import, publish, approval-gated discovery, dispatch once, revoke",
  async (protocol) => {
    const kind = protocol === "openapi" ? "openapi" : "mcp";
    await using workspace = await workspaceFixture();
    const { personal, guestPersonal, repository } = workspace;
    const input = {
      id: randomUUID(),
      kind,
      name: "Synthetic notes",
      endpoint: `https://connector.zoen.test/${kind === "mcp" ? protocol : "api"}`,
      credential: "synthetic-connector-secret",
      share: "owner",
      document: kind === "openapi" ? connectorDocument : undefined,
    } satisfies Parameters<typeof connectTools>[1];
    const connection = await connectTools(personal, input);
    expect(await connectTools(personal, input)).toEqual(connection);
    expect(await listToolConnections(guestPersonal)).toEqual([]);
    const operation = connection.operations[0];
    expect(operation).toBeDefined();
    if (!operation) return;
    const definition = await decodeCustomerTool(
      JSON.stringify(remoteToolDefinition(connection, operation))
    );
    const content = JSON.stringify(definition);
    const draft = await repository.write(personal, {
      operationId: randomUUID(),
      expectedRevision: null,
      path: "proposals/tools/notes.json",
      content,
    });
    expect(await validateCustomerTool(personal, content)).toMatchObject({
      status: "validated",
      tests: 0,
    });
    await publishCustomerTool(personal, {
      slug: "notes",
      expectedRevision: draft.revision,
      operationId: randomUUID(),
    });
    const id = customerToolId("notes", content);
    const execution = workspaceExecutionFor(personal);
    const tools = await resolveCustomerTools(nativeContext(execution));
    expect(tools[id]?.approval).toBeDefined();
    const before = fixture.writes.length;
    expect(tools[id]?.inputSchema).toBeDefined();
    expect(fixture.writes.length).toBe(before);
    const args =
      kind === "mcp"
        ? {
            text: "written once",
          }
        : {
            body: {
              text: "written once",
            },
          };
    const key = `${execution.session.id}:${execution.callId}`;
    const result = await callNativeTool(execution, id, args);
    expect(result).toEqual({
      text: "written once",
    });
    expect(await invokeRemoteTool(personal, definition, args, key)).toEqual(
      result
    );
    expect(fixture.writes.length).toBe(before + 1);
    expect(fixture.credentials.at(-1)).toBe(
      "Bearer synthetic-connector-secret"
    );
    const rows = await query(
      sql`SELECT credentials FROM tool_connections WHERE id = ${connection.id}`
    );
    expect(JSON.stringify(rows)).not.toContain(input.credential);
    const files = await repository.selection(personal, ["tools/notes.json"]);
    expect(JSON.stringify(files)).not.toContain(input.credential);
    const lost =
      kind === "mcp"
        ? {
            text: "lose response",
          }
        : {
            body: {
              text: "lose response",
            },
          };
    const lostKey = randomUUID();
    for (let attempt = 0; attempt < 2; attempt++) {
      const outcome = await Promise.try(async () =>
        invokeRemoteTool(personal, definition, lost, lostKey)
      ).then(
        (value) => ({
          ok: true as const,
          value,
        }),
        (error: unknown) => ({
          ok: false as const,
          error,
        })
      );
      expect(!outcome.ok && outcome.error).toMatchObject({
        reason: "uncertain",
      });
    }
    expect(fixture.writes.length).toBe(before + 2);
    await revokeToolConnection(personal, connection.id);
    expect(await resolveCustomerTools(nativeContext(execution))).toEqual({});
    expect(
      !(
        await Promise.try(async () =>
          invokeRemoteTool(personal, definition, args, key)
        ).then(
          (value) => ({
            ok: true as const,
            value,
          }),
          (error: unknown) => ({
            ok: false as const,
            error,
          })
        )
      ).ok
    ).toBe(true);
    const revoked = await query(
      sql`SELECT credentials FROM tool_connections WHERE id = ${connection.id}`
    );
    expect(revoked[0]?.credentials).toBeNull();
  }
);
test.each(["mcp", "openapi"] as const)(
  "TL remote %s: revocation during network wait blocks the next dispatch or withholds its result",
  async (kind) => {
    await using workspace = await workspaceFixture();
    const { personal } = workspace;
    const connection = await connectTools(personal, {
      id: randomUUID(),
      kind,
      name: "Revocation proof",
      endpoint: `https://connector.zoen.test/${kind === "mcp" ? "mcp" : "api"}`,
      credential: "revocable-secret",
      share: "owner",
      document: kind === "openapi" ? connectorDocument : undefined,
    });
    const operation = connection.operations[0];
    if (!operation) throw new Error("Missing operation");
    const definition = await decodeCustomerTool(
      JSON.stringify(remoteToolDefinition(connection, operation))
    );
    fixture.paused.reached = Promise.withResolvers<undefined>();
    fixture.paused.resume = Promise.withResolvers<undefined>();
    fixture.paused.initialize = kind === "mcp";
    fixture.paused.response = kind === "openapi";
    const before = fixture.writes.length;
    const outcomes = await Promise.try(async () =>
      Promise.all([
        Promise.try(async () =>
          invokeRemoteTool(
            personal,
            definition,
            kind === "mcp"
              ? {
                  text: "revoked",
                }
              : {
                  body: {
                    text: "already dispatched",
                  },
                },
            randomUUID()
          )
        ).then(
          (value) => ({
            ok: true as const,
            value,
          }),
          (error: unknown) => ({
            ok: false as const,
            error,
          })
        ),
        (async function () {
          await fixture.paused.reached.promise;
          await revokeToolConnection(personal, connection.id);
          fixture.paused.resume.resolve(undefined);
        })(),
      ])
    ).finally(() => {
      fixture.paused.resume.resolve(undefined);
      fixture.paused.initialize = false;
      fixture.paused.response = false;
    });
    expect(!outcomes[0].ok).toBe(true);
    expect(fixture.writes.length).toBe(before + (kind === "openapi" ? 1 : 0));
    const receipts = await query(
      sql`SELECT result, status FROM tool_invocations WHERE connection_id = ${connection.id}`
    );
    expect(receipts).toMatchObject([
      {
        result: null,
        status: "uncertain",
      },
    ]);
  }
);
test("TL remote: personal credentials never leak to company members or groups; workspace sharing is explicit", async () => {
  await using workspace = await workspaceFixture();
  const { actor, guest, repository } = workspace;
  const connection = await connectTools(actor, {
    id: randomUUID(),
    kind: "openapi",
    name: "Owner only",
    endpoint: "https://connector.zoen.test/api",
    credential: "owner-secret",
    share: "owner",
    document: connectorDocument,
  });
  expect(await listToolConnections(guest)).toEqual([]);
  expect(
    !(
      await Promise.try(async () =>
        connectTools(guest, {
          id: randomUUID(),
          kind: "openapi",
          name: "No grant",
          endpoint: "https://connector.zoen.test/api",
          credential: "nope",
          share: "workspace",
          document: connectorDocument,
        })
      ).then(
        (value) => ({
          ok: true as const,
          value,
        }),
        (error: unknown) => ({
          ok: false as const,
          error,
        })
      )
    ).ok
  ).toBe(true);
  const installationId = `connectors-${randomUUID()}`;
  const identity = await linkedIdentity(
    {
      channel: "telegram",
      installationId,
      senderId: "owner",
    },
    {
      userId: actor.userId.slice("better-auth:".length),
    }
  );
  const bindingId = randomUUID();
  await query(sql`INSERT INTO workspace_group_bindings(id, workspace_id, channel, installation_id, conversation_id, label, created_by)
    VALUES (${bindingId}, ${actor.workspaceId}, 'telegram', ${installationId}, ${`connector-group-${bindingId}`}, 'Synthetic connector group', ${actor.userId})`);
  const group = {
    userId: actor.userId,
    workspaceId: actor.workspaceId,
    channelIdentityId: identity.id,
    groupBindingId: bindingId,
  };
  expect(await listToolConnections(group)).toEqual([]);
  const shared = await connectTools(actor, {
    id: randomUUID(),
    kind: "openapi",
    name: "Team notes",
    endpoint: "https://connector.zoen.test/api",
    credential: "team-secret",
    share: "workspace",
    document: connectorDocument,
  });
  expect((await listToolConnections(guest)).map((entry) => entry.id)).toEqual([
    shared.id,
  ]);
  expect((await listToolConnections(group)).map((entry) => entry.id)).toEqual([
    shared.id,
  ]);
  const operation = shared.operations[0];
  if (!operation) throw new Error("Missing operation");
  const definition = await decodeCustomerTool(
    JSON.stringify(remoteToolDefinition(shared, operation))
  );
  const content = JSON.stringify(definition);
  const draft = await repository.write(group, {
    operationId: randomUUID(),
    expectedRevision: null,
    path: "proposals/tools/group-notes.json",
    content,
  });
  const publication = {
    slug: "group-notes",
    expectedRevision: draft.revision,
    operationId: randomUUID(),
  };
  expect(
    !(
      await Promise.try(async () =>
        publishCustomerTool(group, publication)
      ).then(
        (value) => ({
          ok: true as const,
          value,
        }),
        (error: unknown) => ({
          ok: false as const,
          error,
        })
      )
    ).ok
  ).toBe(true);
  const published = await publishCustomerTool(actor, publication);
  const id = customerToolId("group-notes", content);
  const skill = await repository.write(group, {
    operationId: randomUUID(),
    expectedRevision: published.revision,
    path: "proposals/skills/group-notes.md",
    content: `---\nrequires: [${id}]\n---\n# Shared notes\n\nCreate a note through the pinned service action after approval.\n`,
  });
  await publishSkillProposal(actor, {
    operationId: randomUUID(),
    expectedRevision: skill.revision,
    proposal: "proposals/skills/group-notes.md",
  });
  const base = workspaceExecutionFor(actor);
  const principal = {
    principalId: actor.userId,
    principalType: "user",
    authenticator: "verified-channel",
    attributes: {
      chatKind: "group",
      workspaceId: actor.workspaceId,
      channelIdentityId: identity.id,
      groupBindingId: bindingId,
    },
  };
  const execution = {
    ...base,
    session: {
      ...base.session,
      auth: {
        current: principal,
        initiator: principal,
      },
    },
  };
  expect(
    JSON.stringify(await readNativeSkill(execution, "skills/group-notes.md"))
  ).toContain('"execution":"instructions"');
  expect(
    JSON.stringify(
      await callNativeTool(execution, "workspace_tools_connections", {})
    )
  ).toContain(shared.id);
  expect(
    await callNativeTool(execution, id, {
      body: {
        text: "group native write",
      },
    })
  ).toEqual({
    text: "group native write",
  });
  await invokeRemoteTool(
    group,
    definition,
    {
      body: {
        text: "group write",
      },
    },
    randomUUID()
  );
  await query(
    sql`UPDATE tool_connections SET credentials = (SELECT credentials FROM tool_connections WHERE id = ${connection.id}) WHERE id = ${shared.id}`
  );
  expect(
    !(
      await Promise.try(async () =>
        toolConnectionCredentials(actor, shared.id, shared.revision)
      ).then(
        (value) => ({
          ok: true as const,
          value,
        }),
        (error: unknown) => ({
          ok: false as const,
          error,
        })
      )
    ).ok
  ).toBe(true);
  await query(
    sql`DELETE FROM organization_memberships WHERE organization_id = (SELECT organization_id FROM workspaces WHERE id = ${actor.workspaceId}) AND user_id = ${guest.userId}`
  );
  expect(
    !(
      await Promise.try(async () => listToolConnections(guest)).then(
        (value) => ({
          ok: true as const,
          value,
        }),
        (error: unknown) => ({
          ok: false as const,
          error,
        })
      )
    ).ok
  ).toBe(true);
});
test("TL remote: competing delivery and changed arguments do not cause another write", async () => {
  await using workspace = await workspaceFixture();
  const { personal } = workspace;
  const connection = await connectTools(personal, {
    id: randomUUID(),
    kind: "openapi",
    name: "Notes",
    endpoint: "https://connector.zoen.test/api",
    credential: "",
    share: "owner",
    document: connectorDocument,
  });
  const operation = connection.operations[0];
  if (!operation) throw new Error("Missing operation");
  const definition = await decodeCustomerTool(
    JSON.stringify(remoteToolDefinition(connection, operation))
  );
  const key = randomUUID();
  const before = fixture.writes.length;
  const outcomes = await Promise.all(
    [1, 2].map(() =>
      Promise.try(async () =>
        invokeRemoteTool(
          personal,
          definition,
          {
            body: {
              text: "concurrent",
            },
          },
          key
        )
      ).then(
        (value) => ({
          ok: true as const,
          value,
        }),
        (error: unknown) => ({
          ok: false as const,
          error,
        })
      )
    )
  );
  expect(outcomes.some((result) => result.ok)).toBe(true);
  expect(fixture.writes.length).toBe(before + 1);
  const mismatch = await Promise.try(async () =>
    invokeRemoteTool(
      personal,
      definition,
      {
        body: {
          text: "different",
        },
      },
      key
    )
  ).then(
    (value) => ({
      ok: true as const,
      value,
    }),
    (error: unknown) => ({
      ok: false as const,
      error,
    })
  );
  expect(
    !mismatch.ok &&
      mismatch.error instanceof ConnectorError &&
      mismatch.error.reason
  ).toBe("changed");
  expect(fixture.writes.length).toBe(before + 1);
});
test("TL remote: removing the credential owner erases the connection and receipts before any rejoin", async () => {
  await using workspace = await workspaceFixture();
  const { actor, guest } = workspace;
  const connection = await connectTools(actor, {
    id: randomUUID(),
    kind: "openapi",
    name: "Donor connection",
    endpoint: "https://connector.zoen.test/api",
    credential: "do-not-retain-this",
    share: "workspace",
    document: connectorDocument,
  });
  const operation = connection.operations[0];
  if (!operation) throw new Error("Missing operation");
  const definition = await decodeCustomerTool(
    JSON.stringify(remoteToolDefinition(connection, operation))
  );
  await invokeRemoteTool(
    guest,
    definition,
    {
      body: {
        text: "before removal",
      },
    },
    randomUUID()
  );
  await query(
    sql`DELETE FROM organization_memberships WHERE organization_id = (SELECT organization_id FROM workspaces WHERE id = ${actor.workspaceId}) AND user_id = ${actor.userId}`
  );
  expect(
    await query(
      sql`SELECT id FROM tool_connections WHERE id = ${connection.id}`
    )
  ).toEqual([]);
  expect(
    await query(
      sql`SELECT id FROM tool_invocations WHERE connection_id = ${connection.id}`
    )
  ).toEqual([]);
  await query(
    sql`INSERT INTO organization_memberships(organization_id, user_id, role) SELECT organization_id, ${actor.userId}, 'admin' FROM workspaces WHERE id = ${actor.workspaceId}`
  );
  expect(await listToolConnections(guest)).toEqual([]);
  expect(
    !(
      await Promise.try(async () =>
        invokeRemoteTool(
          guest,
          definition,
          {
            body: {
              text: "after rejoin",
            },
          },
          randomUUID()
        )
      ).then(
        (value) => ({
          ok: true as const,
          value,
        }),
        (error: unknown) => ({
          ok: false as const,
          error,
        })
      )
    ).ok
  ).toBe(true);
});
