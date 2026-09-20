import { z } from "zod";

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

export const ConnectorInput = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(80),
  endpoint: z.string().min(1).max(1000),
  kind: z.enum(["mcp", "openapi"]),
  credential: z.string().max(8000),
  share: z.enum(["owner", "workspace"]),
  document: z.optional(z.string().max(262_144)),
});
