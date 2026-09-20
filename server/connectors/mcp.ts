import { operationSignal, withTimeout } from "../operations/async";
import { jsonString } from "@shared/validation";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ListToolsResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { ConnectorError, ConnectorOperation } from "./definition";
import { connectorEndpoint, publicFetch } from "./public-fetch";
import type { CustomerToolSchema } from "../workspaces/tool-document";
import { redactConnectorCredential } from "./credentials";
const textOutput = {
  type: "object",
  properties: {
    content: {
      type: "string",
      maxLength: 50_000,
    },
  },
  required: ["content"],
  additionalProperties: false,
};
async function withMcp<A>(
  endpoint: string,
  token: string,
  operation: (client: Client) => Promise<A>
) {
  return withTimeout(async () => {
    const target = connectorEndpoint(endpoint);
    const controller = new AbortController();
    const client = new Client(
      {
        name: "zoen",
        version: "1.0.0",
      },
      {
        capabilities: {},
      }
    );
    const transport = new StreamableHTTPClientTransport(target, {
      reconnectionOptions: {
        maxRetries: 0,
        initialReconnectionDelay: 1000,
        maxReconnectionDelay: 1000,
        reconnectionDelayGrowFactor: 1,
      },
      fetch: async (input, init) => {
        const request = new Request(input, init);
        if (request.url !== target.href)
          throw new Error("MCP attempted a different endpoint.");
        const headers = new Headers(request.headers);
        headers.delete("authorization");
        if (token) headers.set("authorization", `Bearer ${token}`);
        return publicFetch(request, {
          headers,
          signal: AbortSignal.any([
            operationSignal(),
            controller.signal,
            request.signal,
          ]),
        });
      },
    });
    try {
      await client.connect(transport, {
        signal: operationSignal(),
        timeout: 20_000,
      });
      return await operation(client);
    } catch (error) {
      if (error instanceof ConnectorError) throw error;
      throw new ConnectorError({
        reason: "unavailable",
      });
    } finally {
      controller.abort();
      await client.close();
    }
  }, 30_000);
}
export const importMcp = async function (endpoint: string, token: string) {
  const operations = await withMcp(endpoint, token, async (client) => {
    try {
      return await (async (signal) => {
        const tools = [];
        let cursor: string | undefined;
        for (let page = 0; page < 5; page++) {
          // Cursor pages depend on the preceding response and cannot run in parallel.

          const listing = await client.listTools(
            cursor
              ? {
                  cursor,
                }
              : {},
            {
              signal,
              timeout: 20_000,
            }
          );
          const redacted: unknown = JSON.parse(
            redactConnectorCredential(JSON.stringify(listing), token)
          );
          const checked = ListToolsResultSchema.parse(redacted);
          tools.push(...checked.tools);
          if (tools.length > 100) throw new Error("Too many operations");
          cursor = listing.nextCursor;
          if (!cursor) break;
        }
        if (cursor) throw new Error("Too many pages");
        return tools.map((tool) => ({
          id: tool.name,
          name: (tool.title ?? tool.name).slice(0, 80),
          description: (tool.description ?? tool.name).slice(0, 500),
          inputSchema: tool.inputSchema,
          outputSchema: tool.outputSchema ?? textOutput,
          request: {
            kind: "mcp",
            structured: !!tool.outputSchema,
          },
        }));
      })(operationSignal());
    } catch {
      throw new ConnectorError({
        reason: "unavailable",
      });
    }
  });
  return await z.array(ConnectorOperation).parseAsync(operations);
};
export async function invokeMcp(
  endpoint: string,
  token: string,
  operation: z.output<typeof ConnectorOperation>,
  input: z.output<typeof CustomerToolSchema>["inputSchema"],
  authorize: () => Promise<void>
) {
  const definition = operation.request;
  if (definition.kind !== "mcp")
    throw new ConnectorError({
      reason: "invalid",
    });
  const result = await withMcp(endpoint, token, async (client) => {
    await authorize();
    const response = await client.callTool(
      {
        name: operation.id,
        arguments: input,
      },
      undefined,
      {
        signal: operationSignal(),
        timeout: 20_000,
      }
    );
    if (response.isError)
      throw new ConnectorError({
        reason: "unavailable",
      });
    // Remote URLs remain data; they are never downloaded implicitly.
    return definition.structured
      ? response.structuredContent
      : {
          content: JSON.stringify(response.content),
        };
  });
  const decoded = jsonString(z.record(z.string(), z.unknown())).safeParse(
    redactConnectorCredential(JSON.stringify(result), token)
  );
  if (!decoded.success)
    throw new ConnectorError({
      reason: "invalid",
    });
  return decoded.data;
}
