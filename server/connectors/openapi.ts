import { operationSignal } from "../operations/async";
import { ZodError as SchemaError } from "zod";
import { jsonString } from "@shared/validation";
import { z } from "zod";
import { ConnectorError, ConnectorOperation } from "./definition";
import { connectorEndpoint, publicFetch } from "./public-fetch";

const JsonObject = z.record(z.string(), z.unknown());
const Media = z.object({
  content: z.record(z.string(), z.object({ schema: JsonObject })),
});
const Parameter = z.object({
  name: z.string(),
  in: z.enum(["path", "query"]),
  required: z.optional(z.boolean()),
  schema: JsonObject,
});
const Operation = z.object({
  operationId: z.string(),
  summary: z.optional(z.string()),
  description: z.optional(z.string()),
  parameters: z.optional(z.array(Parameter)),
  requestBody: z.optional(Media),
  responses: z.record(z.string(), Media),
});
const Document = z.object({
  openapi: z.string().regex(/^3\.(0|1)\./u),
  paths: z.record(z.string(), JsonObject),
});

/** Import a bounded JSON OpenAPI operation set. No remote $ref resolution,
 * server overrides, header/cookie parameters, or implicit schema coercion.
 */
export const importOpenApi = async function (content: string) {
  try {
    const document = await jsonString(Document).parseAsync(content);
    const operations: z.output<typeof ConnectorOperation>[] = [];
    for (const [path, item] of Object.entries(document.paths)) {
      if (
        !/^\/[A-Za-z0-9_/{}.~-]*$/u.test(path) ||
        path.includes("..") ||
        path.startsWith("//") ||
        item.parameters
      )
        throw new ConnectorError({ reason: "invalid" });
      for (const method of ["get", "post", "put", "patch", "delete"] as const) {
        if (!item[method]) continue;
        const operation = await Operation.parseAsync(item[method]);
        const parameters = operation.parameters ?? [];
        if (
          new Set(parameters.map((parameter) => parameter.name)).size !==
          parameters.length
        )
          throw new ConnectorError({ reason: "invalid" });
        if (
          parameters.some(
            (parameter) =>
              !/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/u.test(parameter.name)
          )
        )
          throw new ConnectorError({ reason: "invalid" });
        const pathParameters = parameters
          .filter((p) => p.in === "path")
          .map((p) => p.name);
        const placeholders = Array.from(
          path.matchAll(/\{([^}]+)\}/gu),
          (match) => match[1]
        );
        if (
          placeholders.some((name) => !pathParameters.includes(name ?? "")) ||
          pathParameters.some((name) => !placeholders.includes(name))
        )
          throw new ConnectorError({ reason: "invalid" });
        const body = operation.requestBody?.content["application/json"]?.schema;
        if ((operation.requestBody && !body) || (body && method === "get"))
          throw new ConnectorError({ reason: "invalid" });
        const response =
          operation.responses["200"] ?? operation.responses["201"];
        const outputSchema = response?.content["application/json"]?.schema;
        if (!outputSchema) throw new ConnectorError({ reason: "invalid" });
        const properties = Object.fromEntries(
          parameters.map((p) => [p.name, p.schema])
        );
        if (body && properties.body)
          throw new ConnectorError({ reason: "invalid" });
        if (body) properties.body = body;
        const inputSchema = {
          type: "object",
          properties,
          required: [
            ...parameters
              .filter((p) => p.required === true || p.in === "path")
              .map((p) => p.name),
            ...(body ? ["body"] : []),
          ],
          additionalProperties: false,
        };
        operations.push(
          await ConnectorOperation.parseAsync({
            id: operation.operationId,
            name: (operation.summary ?? operation.operationId).slice(0, 80),
            description: (
              operation.description ??
              operation.summary ??
              operation.operationId
            ).slice(0, 500),
            inputSchema,
            outputSchema,
            request: {
              kind: "openapi",
              method: method.toUpperCase(),
              path,
              pathParameters,
              queryParameters: parameters
                .filter((p) => p.in === "query")
                .map((p) => p.name),
              body: !!body,
            },
          })
        );
      }
    }
    return operations;
  } catch (error) {
    if (error instanceof SchemaError) {
      throw new ConnectorError({ reason: "invalid" });
    }
    throw error;
  }
};

export const invokeOpenApi = async function (
  endpoint: string,
  token: string,
  operation: z.output<typeof ConnectorOperation>,
  input: z.output<typeof JsonObject>,
  operationId: string
) {
  try {
    const definition = operation.request;
    if (definition.kind !== "openapi")
      throw new ConnectorError({ reason: "invalid" });
    const url = connectorEndpoint(endpoint);
    let path = definition.path;
    for (const name of definition.pathParameters) {
      const value = await z
        .union([z.string(), z.number()])
        .parseAsync(input[name]);
      if (String(value) === "." || String(value) === "..")
        throw new ConnectorError({ reason: "invalid" });
      path = path.replaceAll(`{${name}}`, encodeURIComponent(String(value)));
    }
    url.pathname = `${url.pathname.replace(/\/$/u, "")}${path}`;
    for (const name of definition.queryParameters) {
      const value = input[name];
      if (value !== undefined) {
        const scalar = await z
          .union([z.string(), z.number(), z.boolean()])
          .parseAsync(value);
        url.searchParams.set(name, String(scalar));
      }
    }
    const headers = new Headers({
      Accept: "application/json",
      "Content-Type": "application/json",
      "Idempotency-Key": operationId,
    });
    if (token) headers.set("Authorization", `Bearer ${token}`);
    const text = await Promise.try(async () => {
      return await (async (signal) => {
        const response = await publicFetch(url, {
          method: definition.method,
          signal,
          headers,
          body: definition.body ? JSON.stringify(input.body) : undefined,
        });
        if (
          !response.ok ||
          !response.headers.get("content-type")?.includes("application/json")
        )
          throw new Error("Unavailable");
        return response.text();
      })(operationSignal());
    }).catch(() => {
      throw new ConnectorError({ reason: "unavailable" });
    });
    return await jsonString(JsonObject).parseAsync(text);
  } catch (error) {
    if (error instanceof SchemaError) {
      throw new ConnectorError({ reason: "invalid" });
    }
    throw error;
  }
};
