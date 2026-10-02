import { z } from "zod";
import {
  postgresEndpointSchema,
  postgresIdentifierSchema,
} from "@zoen/companion-ui/workspace-sources";

const JsonObject = z.record(z.string(), z.unknown());
export const ConnectorOperation = z.object({
  id: z.string().min(1).max(120),
  name: z.string().min(1).max(80),
  description: z.string().min(1).max(500),
  inputSchema: JsonObject,
  outputSchema: JsonObject,
  request: z.union([
    z.object({ kind: z.literal("mcp"), structured: z.boolean() }),
    z.object({
      kind: z.literal("openapi"),
      method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
      path: z.string().max(500),
      pathParameters: z.array(z.string()),
      queryParameters: z.array(z.string()),
      body: z.boolean(),
    }),
  ]),
});
export const ConnectorOperations = z.array(ConnectorOperation).min(1).max(100);
export const ConnectorDiscovery = z.object({
  connectionId: z.optional(z.uuid()),
  offset: z.optional(z.number().int().min(0).max(100)),
});
export class ConnectorError extends Error {
  readonly _tag = "ConnectorError";
  declare readonly reason:
    | "invalid"
    | "unavailable"
    | "changed"
    | "denied"
    | "uncertain";
  constructor(input: {
    readonly reason:
      | "invalid"
      | "unavailable"
      | "changed"
      | "denied"
      | "uncertain";
  }) {
    super("ConnectorError");
    this.name = "ConnectorError";
    Object.assign(this, input);
  }
}

const HttpCredentialSchema = z
  .string()
  .max(8000)
  .refine(
    (value) => !/[\r\n\uD800-\uDFFF]/u.test(value),
    "Use well-formed HTTP credential text without line breaks"
  );
export const PostgresCredentialSchema = z.strictObject({
  username: postgresIdentifierSchema,
  password: z
    .string()
    .min(1)
    .max(8000)
    .refine(
      (value) =>
        !/[\0\uD800-\uDFFF]/u.test(value) &&
        new TextEncoder().encode(value).byteLength <= 8000,
      "Use a well-formed password of at most 8000 UTF-8 bytes without NUL"
    ),
});
export const ConnectorCredentialSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.enum(["mcp", "openapi"]),
    value: HttpCredentialSchema,
  }),
  z.strictObject({
    kind: z.literal("postgres"),
    value: PostgresCredentialSchema,
  }),
]);
const connectionIdentity = {
  id: z.uuid(),
  name: z.string().min(1).max(80),
  connected_by: z.string().min(1),
  revision: z.uuid(),
  share: z.enum(["owner", "workspace"]),
};
export const RemoteConnectionSchema = z.strictObject({
  ...connectionIdentity,
  kind: z.enum(["mcp", "openapi"]),
  endpoint: z.string().min(1).max(1000),
  operations: ConnectorOperations,
  postgres_config: z.null(),
});
export const ConnectionSchema = z.discriminatedUnion("kind", [
  RemoteConnectionSchema,
  z.strictObject({
    ...connectionIdentity,
    kind: z.literal("postgres"),
    endpoint: z.null(),
    operations: z.null(),
    postgres_config: postgresEndpointSchema,
  }),
]);
const connectionInput = {
  id: connectionIdentity.id,
  name: connectionIdentity.name,
  share: connectionIdentity.share,
};
export const ConnectorInput = z.discriminatedUnion("kind", [
  z.strictObject({
    ...connectionInput,
    kind: z.enum(["mcp", "openapi"]),
    endpoint: z.string().min(1).max(1000),
    credential: HttpCredentialSchema,
    document: z.optional(z.string().max(262_144)),
  }),
  z.strictObject({
    ...connectionInput,
    kind: z.literal("postgres"),
    configuration: postgresEndpointSchema,
    credential: PostgresCredentialSchema,
  }),
]);
