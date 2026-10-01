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
  ConnectorInput,
  ConnectionSchema,
  type RemoteConnectionSchema,
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

const fingerprint = (input: z.output<typeof ConnectorInput>) =>
  createHash("sha256").update(JSON.stringify(input)).digest("hex");

export const listToolConnections = async function (
  actor: z.output<typeof WorkspaceActorSchema>
) {
  return await withDatabaseTransaction(async () => {
    await requireWorkspaceAccess(actor);
    if (actor.agentGrantId) return [];
    const rows =
      await query(sql`SELECT id, name, kind, endpoint, connected_by, revision, operations, postgres_config, share FROM tool_connections
    WHERE workspace_id = ${actor.workspaceId} AND revoked_at IS NULL
      AND (kind <> 'postgres' OR (${!!actor.authSessionId} AND ${!actor.groupBindingId}))
      AND (share = 'workspace' OR (connected_by = ${actor.userId} AND ${!actor.groupBindingId})) ORDER BY created_at`);
    return await z.array(ConnectionSchema).parseAsync(rows);
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
  const connections = (await listToolConnections(actor)).filter(
    (connection) => connection.kind !== "postgres"
  );
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
  connection: z.output<typeof RemoteConnectionSchema>,
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
  if (connection.kind === "postgres")
    throw new ConnectorError({ reason: "denied" });
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
  rawInput: z.output<typeof ConnectorInput>
) {
  await requireWorkspaceAccess(actor, true);
  if (!actor.authSessionId || actor.groupBindingId)
    throw new WorkspaceAccessDenied();
  const input = await ConnectorInput.parseAsync(rawInput).catch(() => {
    throw new ConnectorError({ reason: "invalid" });
  });
  if (input.kind !== "postgres")
    await Promise.try(async () => connectorEndpoint(input.endpoint)).catch(
      () => {
        throw new ConnectorError({ reason: "invalid" });
      }
    );
  const hash = fingerprint(input);
  const existing =
    await query(sql`SELECT id FROM tool_connections WHERE id = ${input.id} AND workspace_id = ${actor.workspaceId}
    AND connected_by = ${actor.userId} AND request_hash = ${hash} AND revoked_at IS NULL`);
  if (existing.length) return await readToolConnection(actor, input.id);
  const revision = randomUUID();
  const identity = {
    id: input.id,
    name: input.name,
    share: input.share,
    revision,
    connected_by: actor.userId,
  };
  let connection: z.output<typeof ConnectionSchema>;
  if (input.kind === "postgres") {
    // Registration stores a typed configuration only. Live reads require the
    // governed source/admission boundary, which is not enabled by this registry.
    connection = {
      ...identity,
      kind: "postgres",
      endpoint: null,
      operations: null,
      postgres_config: input.configuration,
    };
  } else {
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
    const remote = {
      ...identity,
      kind: input.kind,
      endpoint: input.endpoint,
      operations,
      postgres_config: null,
    };
    // Import and publication use one remote tool schema owner.
    await mapAsync(
      operations,
      (operation) =>
        decodeCustomerTool(
          JSON.stringify(remoteToolDefinition(remote, operation))
        ),
      1
    );
    connection = remote;
  }
  const credentials = await sealConnectorCredential(
    { workspaceId: actor.workspaceId, id: input.id, revision },
    input.kind === "postgres"
      ? { kind: "postgres", value: input.credential }
      : { kind: input.kind, value: input.credential }
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
      await query(sql`INSERT INTO tool_connections(id, workspace_id, connected_by, organization_id, name, kind, endpoint, credentials, revision, operations, postgres_config, share, request_hash)
      VALUES (${input.id}, ${actor.workspaceId}, ${actor.userId}, ${access.organizationId}, ${input.name}, ${input.kind}, ${connection.endpoint}, ${credentials}, ${revision}, ${connection.operations === null ? null : JSON.stringify(connection.operations)}::jsonb, ${connection.postgres_config === null ? null : JSON.stringify(connection.postgres_config)}::jsonb, ${input.share}, ${hash})
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
  const connection = await readToolConnection(actor, id, revision);
  if (connection.kind === "postgres")
    throw new ConnectorError({ reason: "denied" });

  const rows = await query(
    sql`SELECT credentials FROM tool_connections WHERE id = ${id} AND workspace_id = ${actor.workspaceId} AND revision = ${revision} AND revoked_at IS NULL`
  );
  const row = await z.object({ credentials: z.string() }).parseAsync(rows[0]);
  const credential = await openConnectorCredential(
    { workspaceId: actor.workspaceId, id, revision },
    connection.kind,
    row.credentials
  );
  if (credential.kind === "postgres")
    throw new ConnectorError({ reason: "denied" });
  return credential.value;
};
