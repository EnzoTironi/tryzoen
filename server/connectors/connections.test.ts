import { beforeEach, expect, test, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type * as Credentials from "./credentials";
import {
  connectTools,
  discoverToolConnections,
  listToolConnections,
  requireRemoteTool,
  toolConnectionCredentials,
} from "./connections";
import type { ConnectorInput, ConnectionSchema } from "./definition";
import { decodeCustomerTool } from "../workspaces/tool-document";
import { WorkspaceAccessDenied } from "../workspaces/access";
import type { z } from "zod";

const boundary = vi.hoisted(() => ({
  query: vi.fn<(statement: SQL) => Promise<Record<string, unknown>[]>>(),
  access:
    vi.fn<
      (
        actor: unknown,
        manage?: boolean
      ) => Promise<{ organizationId: string | null }>
    >(),
  importMcp: vi.fn<() => Promise<unknown>>(),
  importOpenApi: vi.fn<() => Promise<unknown>>(),
  seal: vi.fn<typeof Credentials.sealConnectorCredential>(),
  open: vi.fn<typeof Credentials.openConnectorCredential>(),
}));
vi.mock("@db/queries", () => ({
  query: boundary.query,
  transaction: async (run: () => Promise<unknown>) => run(),
}));
vi.mock("../workspaces/access", () => ({
  requireWorkspaceAccess: boundary.access,
  WorkspaceAccessDenied: class extends Error {
    constructor() {
      super("WorkspaceAccessDenied");
    }
  },
}));
vi.mock("./mcp", () => ({ importMcp: boundary.importMcp }));
vi.mock("./openapi", () => ({ importOpenApi: boundary.importOpenApi }));
vi.mock("./credentials", async (original) => ({
  ...(await original<typeof Credentials>()),
  sealConnectorCredential: boundary.seal,
  openConnectorCredential: boundary.open,
}));
const dialect = new PgDialect();
const statements = () =>
  boundary.query.mock.calls.map(([statement]) => dialect.sqlToQuery(statement));
const actor = {
  userId: "better-auth:alice",
  workspaceId: "personal-alice",
  authSessionId: "alice-session",
};
const identity = {
  id: "d60420cc-d208-41cf-b7ba-940ac08c0e3e",
  revision: "23e70990-050b-4173-a811-c45b630ff973",
  name: "Studio",
  connected_by: actor.userId,
  share: "owner" as const,
};
const config = {
  host: "db.example.com",
  port: 5432,
  database: "studio",
  tls: "verify-full" as const,
};
const pg: z.output<typeof ConnectionSchema> = {
  ...identity,
  kind: "postgres",
  endpoint: null,
  operations: null,
  postgres_config: config,
};
const operation = {
  id: "notes",
  name: "Notes",
  description: "Read notes",
  inputSchema: {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false,
  },
  request: { kind: "mcp" as const, structured: true },
};
const http: z.output<typeof ConnectionSchema> = {
  ...identity,
  id: "587f9cfe-c04a-45ec-bf90-e5b0fc68031e",
  kind: "mcp",
  endpoint: "https://example.com/mcp",
  operations: [operation],
  postgres_config: null,
};
let rows: z.output<typeof ConnectionSchema>[];
beforeEach(() => {
  vi.clearAllMocks();
  rows = [http, pg];
  boundary.access.mockResolvedValue({ organizationId: null });
  boundary.importMcp.mockResolvedValue([operation]);
  boundary.importOpenApi.mockResolvedValue([operation]);
  boundary.seal.mockResolvedValue("encrypted-synthetic");
  boundary.open.mockResolvedValue({ kind: "mcp", value: "synthetic-token" });
  boundary.query.mockImplementation(async (statement) => {
    const compiled = dialect.sqlToQuery(statement);
    if (compiled.sql.includes("SELECT id, name, kind")) return rows;
    if (compiled.sql.includes("SELECT credentials"))
      return [{ credentials: "encrypted-synthetic" }];
    if (compiled.sql.includes("INSERT INTO tool_connections"))
      return [{ id: pg.id }];
    return [];
  });
});
test("app listing includes typed PostgreSQL metadata without secrets", async () => {
  expect(await listToolConnections(actor)).toEqual(rows);
  expect(boundary.access).toHaveBeenCalledWith(actor);
  expect(JSON.stringify(await listToolConnections(actor))).not.toContain(
    "password"
  );
});
test("SQL visibility limits PostgreSQL to authenticated app actors; grants receive no connection list", async () => {
  await listToolConnections({
    ...actor,
    authSessionId: undefined,
    channelIdentityId: "channel",
  });
  expect(statements()[0]?.sql).toContain("kind <> 'postgres'");
  expect(statements()[0]?.params).toContain(false);
  boundary.query.mockClear();
  expect(
    await listToolConnections({
      ...actor,
      authSessionId: undefined,
      agentGrantId: "grant",
    })
  ).toEqual([]);
  expect(boundary.query).not.toHaveBeenCalled();
});
test("remote discovery excludes PostgreSQL and refuses explicit selection", async () => {
  const result = await discoverToolConnections(actor, {});
  expect(result.connections).toHaveLength(1);
  expect(JSON.stringify(result)).not.toContain(config.database);
  await expect(
    discoverToolConnections(actor, { connectionId: pg.id })
  ).rejects.toMatchObject({ reason: "denied" });
  expect(boundary.open).not.toHaveBeenCalled();
});
test("PostgreSQL cannot become a remote published tool", async () => {
  const definition = await decodeCustomerTool(
    JSON.stringify({
      name: "Notes",
      description: "Read notes",
      inputSchema: operation.inputSchema,
      outputSchema: operation.outputSchema,
      implementation: {
        kind: "mcp",
        connectionId: pg.id,
        revision: pg.revision,
        operation: "notes",
      },
      tests: [],
    })
  );
  await expect(requireRemoteTool(actor, definition)).rejects.toMatchObject({
    reason: "denied",
  });
  expect(boundary.open).not.toHaveBeenCalled();
});
test("PostgreSQL token request denies before encrypted credential SELECT or decryption", async () => {
  await expect(
    toolConnectionCredentials(actor, pg.id, pg.revision)
  ).rejects.toMatchObject({ reason: "denied" });
  expect(
    statements().some(({ sql }) => sql.includes("SELECT credentials"))
  ).toBe(false);
  expect(boundary.open).not.toHaveBeenCalled();
});
test("HTTP token lookup pins exact encrypted kind, workspace, connection and revision", async () => {
  expect(await toolConnectionCredentials(actor, http.id, http.revision)).toBe(
    "synthetic-token"
  );
  expect(boundary.open).toHaveBeenCalledWith(
    { workspaceId: actor.workspaceId, id: http.id, revision: http.revision },
    "mcp",
    "encrypted-synthetic"
  );
  boundary.open.mockResolvedValue({
    kind: "postgres",
    value: { username: "reader", password: "synthetic" },
  });
  await expect(
    toolConnectionCredentials(actor, http.id, http.revision)
  ).rejects.toMatchObject({ reason: "denied" });
});
test.each([null, "company-studio"])(
  "registers PostgreSQL for the authorized personal/company workspace (%s) without provider I/O",
  async (organizationId) => {
    boundary.access.mockResolvedValue({ organizationId });
    rows = [pg];
    const input: z.output<typeof ConnectorInput> = {
      id: pg.id,
      name: pg.name,
      kind: "postgres",
      configuration: { ...config, host: "DB.Example.Com" },
      credential: { username: "reader", password: "synthetic\npassword" },
      share: "owner",
    };
    expect(await connectTools(actor, input)).toEqual(pg);
    expect(boundary.importMcp).not.toHaveBeenCalled();
    expect(boundary.importOpenApi).not.toHaveBeenCalled();
    expect(boundary.open).not.toHaveBeenCalled();
    const sealedScope = boundary.seal.mock.calls[0]?.[0];
    expect(sealedScope?.workspaceId).toBe(actor.workspaceId);
    expect(sealedScope?.id).toBe(input.id);
    expect(sealedScope?.revision).toMatch(/^[a-f0-9-]{36}$/u);
    expect(boundary.seal.mock.calls[0]?.[1]).toEqual({
      kind: "postgres",
      value: input.credential,
    });
    const insert = statements().find(({ sql }) =>
      sql.includes("INSERT INTO tool_connections")
    );
    expect(insert?.params).toContain(JSON.stringify(config));
    expect(insert?.params).toContain(organizationId);
    expect(JSON.stringify(insert?.params)).not.toContain(
      input.credential.password
    );
    expect(boundary.access).toHaveBeenNthCalledWith(1, actor, true);
    expect(boundary.access).toHaveBeenNthCalledWith(2, actor, true);
  }
);
test("registration requires app human authorization before importing/sealing anything", async () => {
  const input: z.output<typeof ConnectorInput> = {
    id: pg.id,
    name: pg.name,
    kind: "postgres",
    configuration: config,
    credential: { username: "reader", password: "synthetic" },
    share: "owner",
  };
  await expect(
    connectTools({ ...actor, authSessionId: undefined }, input)
  ).rejects.toThrow("WorkspaceAccessDenied");
  boundary.access.mockRejectedValue(new WorkspaceAccessDenied());
  await expect(connectTools(actor, input)).rejects.toThrow(
    "WorkspaceAccessDenied"
  );
  expect(boundary.seal).not.toHaveBeenCalled();
  expect(boundary.importMcp).not.toHaveBeenCalled();
});
test("registration revalidates current authority before its insert", async () => {
  boundary.access
    .mockResolvedValueOnce({ organizationId: null })
    .mockRejectedValueOnce(new WorkspaceAccessDenied());
  await expect(
    connectTools(actor, {
      id: pg.id,
      name: pg.name,
      kind: "postgres",
      configuration: config,
      credential: { username: "reader", password: "synthetic" },
      share: "owner",
    })
  ).rejects.toThrow("WorkspaceAccessDenied");
  expect(
    statements().some(({ sql }) => sql.includes("INSERT INTO tool_connections"))
  ).toBe(false);
});
