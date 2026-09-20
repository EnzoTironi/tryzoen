import { ZodError as SchemaError } from "zod";
import { jsonString, isValid } from "@shared/validation";
import { createHash } from "node:crypto";

import { z } from "zod";
import { WorkspacePathSchema } from "./git";

export const ToolSlug = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/u);
export const ToolProposalPath = WorkspacePathSchema.regex(
  /^proposals\/tools\/[a-z][a-z0-9-]{0,39}\.json$/u
);
export const PublishedToolPath = WorkspacePathSchema.regex(
  /^tools\/[a-z][a-z0-9-]{0,39}\.json$/u
);
const JsonObject = z.record(z.string(), z.unknown());
const CodeTool = z.object({
  kind: z.literal("code"),
  code: z.string().min(1).max(16_000),
  requires: z.array(z.string().max(80)).max(12),
});
const RemoteTool = z.object({
  kind: z.enum(["mcp", "openapi"]),
  connectionId: z.uuid(),
  revision: z.uuid(),
  operation: z.string().min(1).max(120),
});

export const CustomerToolSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().min(1).max(500),
  inputSchema: JsonObject,
  outputSchema: JsonObject,
  implementation: z.union([CodeTool, RemoteTool]),
  tests: z
    .array(
      z.object({
        input: JsonObject,
        expected: JsonObject,
        fixtures: z.record(z.string(), JsonObject),
      })
    )
    .max(5),
});

export class CustomerToolError extends Error {
  readonly _tag = "CustomerToolError";
  declare readonly reason:
    | "invalid_definition"
    | "invalid_input"
    | "invalid_output"
    | "test_failed"
    | "dependency_unavailable"
    | "unavailable"
    | "execution_failed"
    | "connection_changed"
    | "uncertain";
  constructor(input: {
    readonly reason:
      | "invalid_definition"
      | "invalid_input"
      | "invalid_output"
      | "test_failed"
      | "dependency_unavailable"
      | "unavailable"
      | "execution_failed"
      | "connection_changed"
      | "uncertain";
  }) {
    super("CustomerToolError");
    this.name = "CustomerToolError";
    Object.assign(this, input);
  }
}

// No references, regexes or executable schema extensions run on the host.
// Limits apply to schema structure, not just its serialized byte size.
function safeSchema(value: unknown, depth = 0): boolean {
  if (
    !isValid(JsonObject, value) ||
    depth > 8 ||
    Object.keys(value).length > 12
  )
    return false;
  const allowed = new Set([
    "type",
    "properties",
    "required",
    "additionalProperties",
    "items",
    "description",
    "enum",
    "minimum",
    "maximum",
    "minLength",
    "maxLength",
    "minItems",
    "maxItems",
    "title",
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key))) return false;
  if (
    !["object", "array", "string", "number", "integer", "boolean"].includes(
      String(value.type)
    )
  )
    return false;
  if (value.type === "object") {
    if (
      value.additionalProperties !== false ||
      !isValid(JsonObject, value.properties)
    )
      return false;
    if (Object.keys(value.properties).length > 40) return false;
    if (
      !Object.values(value.properties).every(
        (property) =>
          isValid(JsonObject, property) && safeSchema(property, depth + 1)
      )
    )
      return false;
  }
  if (
    value.type === "array" &&
    (!isValid(JsonObject, value.items) || !safeSchema(value.items, depth + 1))
  )
    return false;
  return true;
}

export const decodeCustomerTool = async function (content: string) {
  try {
    if (Buffer.byteLength(content) > 32_768)
      throw new CustomerToolError({ reason: "invalid_definition" });
    const tool = await jsonString(CustomerToolSchema.strict()).parseAsync(
      content
    );
    if (tool.implementation.kind === "code" && tool.tests.length === 0)
      throw new CustomerToolError({ reason: "invalid_definition" });
    if (
      tool.inputSchema.type !== "object" ||
      tool.outputSchema.type !== "object" ||
      !safeSchema(tool.inputSchema) ||
      !safeSchema(tool.outputSchema)
    )
      throw new CustomerToolError({ reason: "invalid_definition" });
    await Promise.try(async () => {
      (() => {
        z.fromJSONSchema(tool.inputSchema);
        z.fromJSONSchema(tool.outputSchema);
      })();
    }).catch(() => {
      throw new CustomerToolError({ reason: "invalid_definition" });
    });
    return tool;
  } catch (error) {
    if (error instanceof SchemaError) {
      throw new CustomerToolError({ reason: "invalid_definition" });
    }
    throw error;
  }
};

export function customerToolId(slug: string, content: string) {
  return `custom_${slug.slice(0, 31)}_${createHash("sha256").update(slug).update("\0").update(content).digest("hex").slice(0, 24)}`;
}

export const decodeCustomerValue = async function (
  schema: z.output<typeof JsonObject>,
  value: unknown,
  output = false
) {
  try {
    const result = await Promise.try(async () =>
      z.fromJSONSchema(schema).safeParse(value)
    ).catch(() => {
      throw new CustomerToolError({
        reason: output ? "invalid_output" : "invalid_input",
      });
    });
    if (
      !result.success ||
      Buffer.byteLength(JSON.stringify(result.data)) > 65_536
    )
      throw new CustomerToolError({
        reason: output ? "invalid_output" : "invalid_input",
      });
    return await JsonObject.parseAsync(result.data);
  } catch (error) {
    if (error instanceof SchemaError) {
      throw new CustomerToolError({ reason: "invalid_output" });
    }
    throw error;
  }
};
