import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { z } from "zod";

/** The private engine's bounded JSON-over-MCP contract. Scope belongs to each caller. */
export async function memoryTool(
  client: Client,
  name: string,
  args: Record<string, unknown>,
  options: { signal?: AbortSignal; maxResultCharacters?: number } = {}
) {
  const limit = z
    .number()
    .int()
    .positive()
    .max(4 * 1024 * 1024)
    .default(64 * 1024)
    .parse(options.maxResultCharacters);
  const result = await client.callTool({ name, arguments: args }, undefined, {
    timeout: 20_000,
    signal: options.signal,
  });
  if (result.isError) throw new Error("The private memory operation failed.");
  const content = z
    .array(z.object({ type: z.literal("text"), text: z.string().max(limit) }))
    .max(1)
    .parse(result.content);
  return z
    .record(z.string(), z.unknown())
    .parse(JSON.parse(content.map((part) => part.text).join("")));
}
