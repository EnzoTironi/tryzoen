import { query, transaction as withDatabaseTransaction } from "@db/queries";
import { sql } from "drizzle-orm";
import { mapAsync } from "../operations/async";
import { z } from "zod";
import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  requireWorkspaceAccess,
  WorkspaceAccessDenied,
  type WorkspaceActorSchema,
} from "../workspaces/access";
import {
  decodeCustomerTool,
  type CustomerToolSchema,
} from "../workspaces/tool-document";
import {
  ConnectorError,
  type ConnectorInput,
  ConnectorOperations,
  type ConnectorDiscovery,
} from "./definition";
import { connectorEndpoint } from "./public-fetch";
import { importOpenApi } from "./openapi";
import { importMcp } from "./mcp";
import {
  openConnectorCredential,
  sealConnectorCredential,
  redactConnectorCredential,
} from "./credentials";

const Connection = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(["mcp", "openapi"]),
  endpoint: z.string(),
  connected_by: z.string(),
  revision: z.string(),
  operations: ConnectorOperations,
  share: z.enum(["owner", "workspace"]),
});
const fingerprint = (input: z.output<typeof ConnectorInput>) =>
  createHash("sha256").update(JSON.stringify(input)).digest("hex");

export const listToolConnections = async function (
  actor: z.output<typeof WorkspaceActorSchema>
) {
  return await withDatabaseTransaction(async () => {
    await requireWorkspaceAccess(actor);
    if (actor.agentGrantId) return [];
    const rows =
      await query(sql`SELECT id, name, kind, endpoint, connected_by, revision, operations, share FROM tool_connections
    WHERE workspace_id = ${actor.workspaceId} AND revoked_at IS NULL
      AND (share = 'workspace' OR (connected_by = ${actor.userId} AND ${!actor.groupBindingId})) ORDER BY created_at`);
    return await z.array(Connection).parseAsync(rows);
  });
};

export const readToolConnection = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  id: string,
  revision?: string
) {
  const connection = (await listToolConnections(actor)).find(
    (entry) => entry.id === id
  );
  if (!connection || (revision && connection.revision !== revision))
    throw new ConnectorError({ reason: "changed" });
  return connection;
};

export const discoverToolConnections = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  input: z.output<typeof ConnectorDiscovery>
) {
  const connections = await listToolConnections(actor);
  const metadata = connections.map(({ operations, ...connection }) => ({
    ...connection,
    operationCount: operations.length,
  }));
  if (!input.connectionId) return { connections: metadata };
  const connection = connections.find(
    (entry) => entry.id === input.connectionId
  );
  if (!connection) throw new ConnectorError({ reason: "denied" });
  const offset = input.offset ?? 0;
  const operations = connection.operations.slice(offset, offset + 3);
  return {
    connection: metadata.find((entry) => entry.id === connection.id),
    operations,
    nextOffset:
      offset + operations.length < connection.operations.length
        ? offset + operations.length
        : null,
  };
};

export const remoteToolDefinition = (
  connection: z.output<typeof Connection>,
  operation: z.output<typeof ConnectorOperations>[number]
) => ({
  name: operation.name,
  description: operation.description,
  inputSchema: operation.inputSchema,
  outputSchema: operation.outputSchema,
  implementation: {
    kind: connection.kind,
    connectionId: connection.id,
    revision: connection.revision,
    operation: operation.id,
  },
  tests: [],
});

export const requireRemoteTool = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  definition: z.output<typeof CustomerToolSchema>
) {
  const implementation = definition.implementation;
  if (implementation.kind === "code")
    throw new ConnectorError({ reason: "invalid" });
  const connection = await readToolConnection(
    actor,
    implementation.connectionId,
    implementation.revision
  );
  const operation = connection.operations.find(
    (entry) => entry.id === implementation.operation
  );
  if (
    !operation ||
    connection.kind !== implementation.kind ||
    !isDeepStrictEqual(operation.inputSchema, definition.inputSchema) ||
    !isDeepStrictEqual(operation.outputSchema, definition.outputSchema)
  )
    throw new ConnectorError({ reason: "changed" });
  return { connection, operation };
};

export const connectTools = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  input: z.output<typeof ConnectorInput>
) {
  await requireWorkspaceAccess(actor, true);
  if (!actor.authSessionId) throw new WorkspaceAccessDenied();
  await Promise.try(async () => connectorEndpoint(input.endpoint)).catch(() => {
    throw new ConnectorError({ reason: "invalid" });
  });
  if (/[\r\n]/u.test(input.credential))
    throw new ConnectorError({ reason: "invalid" });

  const hash = fingerprint(input);
  const existing =
    await query(sql`SELECT id FROM tool_connections WHERE id = ${input.id} AND workspace_id = ${actor.workspaceId}
    AND connected_by = ${actor.userId} AND request_hash = ${hash} AND revoked_at IS NULL`);
  if (existing.length) return await readToolConnection(actor, input.id);
  const imported =
    input.kind === "mcp"
      ? await importMcp(input.endpoint, input.credential)
      : await importOpenApi(
          redactConnectorCredential(input.document ?? "", input.credential)
        );
  const operations = await ConnectorOperations.parseAsync(imported);
  if (
    new Set(operations.map((operation) => operation.id)).size !==
    operations.length
  )
    throw new ConnectorError({ reason: "invalid" });
  const revision = randomUUID();
  const candidate = {
    ...input,
    revision,
    operations,
    connected_by: actor.userId,
  };
  // Import uses the same schema owner as publication, rejecting unsupported
  // refs or schema extensions before any remote operation becomes discoverable.
  await mapAsync(
    operations,
    (operation) =>
      decodeCustomerTool(
        JSON.stringify(remoteToolDefinition(candidate, operation))
      ),
    1
  );
  const credentials = await sealConnectorCredential(
    actor.workspaceId,
    input.id,
    revision,
    input.credential
  );
  await withDatabaseTransaction(async () => {
    const access = await requireWorkspaceAccess(actor, true);
    await query(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${actor.workspaceId}, 5861))`
    );
    const active = await query(
      sql`SELECT id FROM tool_connections WHERE workspace_id = ${actor.workspaceId} AND revoked_at IS NULL`
    );
    if (active.length >= 20)
      throw new ConnectorError({ reason: "unavailable" });
    const inserted =
      await query(sql`INSERT INTO tool_connections(id, workspace_id, connected_by, organization_id, name, kind, endpoint, credentials, revision, operations, share, request_hash)
      VALUES (${input.id}, ${actor.workspaceId}, ${actor.userId}, ${access.organizationId}, ${input.name}, ${input.kind}, ${input.endpoint}, ${credentials}, ${revision}, ${JSON.stringify(operations)}::jsonb, ${input.share}, ${hash})
      ON CONFLICT (id) DO NOTHING RETURNING id`);
    if (!inserted.length) throw new ConnectorError({ reason: "changed" });
    return undefined;
  });
  return await readToolConnection(actor, input.id);
};

export const revokeToolConnection = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  id: string
) {
  if (!actor.authSessionId) throw new WorkspaceAccessDenied();

  await withDatabaseTransaction(async () => {
    await requireWorkspaceAccess(actor, true);
    await query(sql`UPDATE tool_connections SET credentials = NULL, revoked_at = now(), revision = ${randomUUID()}
    WHERE id = ${id} AND workspace_id = ${actor.workspaceId} AND revoked_at IS NULL`);
    await query(
      sql`UPDATE tool_invocations SET result = NULL WHERE connection_id = ${id} AND workspace_id = ${actor.workspaceId}`
    );
    return undefined;
  });
};

export const toolConnectionCredentials = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  id: string,
  revision: string
) {
  await readToolConnection(actor, id, revision);

  const rows = await query(
    sql`SELECT credentials FROM tool_connections WHERE id = ${id} AND workspace_id = ${actor.workspaceId} AND revision = ${revision} AND revoked_at IS NULL`
  );
  const row = await z.object({ credentials: z.string() }).parseAsync(rows[0]);
  return await openConnectorCredential(
    actor.workspaceId,
    id,
    revision,
    row.credentials
  );
};
