import { query, transaction as withDatabaseTransaction } from "@db/queries";
import { sql } from "drizzle-orm";
import { withTimeout } from "../operations/async";
import { jsonString } from "@shared/validation";
import { z } from "zod";
import { createHash, randomUUID } from "node:crypto";

import {
  decodeCustomerValue,
  type CustomerToolSchema,
} from "../workspaces/tool-document";
import type { WorkspaceActorSchema } from "../workspaces/access";
import { ConnectorError } from "./definition";
import { requireRemoteTool, toolConnectionCredentials } from "./connections";
import { invokeMcp } from "./mcp";
import { invokeOpenApi } from "./openapi";
import { redactConnectorCredential } from "./credentials";
const remoteRequests = new Set<Promise<void>>();

export const invokeRemoteTool = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  definition: z.output<typeof CustomerToolSchema>,
  input: unknown,
  invocationKey: string
) {
  while (remoteRequests.size >= 8) await Promise.race(remoteRequests);
  const slot = Promise.withResolvers<void>();
  remoteRequests.add(slot.promise);
  try {
    return await withTimeout(async () => {
      const { connection, operation } = await requireRemoteTool(
        actor,
        definition
      );
      const decoded = await decodeCustomerValue(operation.inputSchema, input);
      const token = await toolConnectionCredentials(
        actor,
        connection.id,
        connection.revision
      );

      const requestHash = createHash("sha256")
        .update(
          JSON.stringify({
            userId: actor.userId,
            groupBindingId: actor.groupBindingId,
            connectionId: connection.id,
            revision: connection.revision,
            operation: operation.id,
            input: decoded,
          })
        )
        .digest("hex");
      const id = randomUUID();
      const claimed =
        await query(sql`INSERT INTO tool_invocations(id, workspace_id, connection_id, invocation_key, request_hash, status)
    VALUES (${id}, ${actor.workspaceId}, ${connection.id}, ${invocationKey}, ${requestHash}, 'started')
    ON CONFLICT (workspace_id, invocation_key) DO NOTHING RETURNING id`);
      if (!claimed.length) {
        const receipts = await query(
          sql`SELECT request_hash, status, result FROM tool_invocations WHERE workspace_id = ${actor.workspaceId} AND invocation_key = ${invocationKey}`
        );
        const receipt = await z
          .object({
            request_hash: z.string(),
            status: z.string(),
            result: z.nullable(z.record(z.string(), z.unknown())),
          })
          .parseAsync(receipts[0]);
        if (receipt.request_hash !== requestHash)
          throw new ConnectorError({ reason: "changed" });
        if (receipt.status !== "completed" || !receipt.result)
          throw new ConnectorError({ reason: "uncertain" });
        await requireRemoteTool(actor, definition);
        return await decodeCustomerValue(
          operation.outputSchema,
          receipt.result,
          true
        );
      }
      // The durable claim is committed before HTTP. If a process dies or the
      // provider times out after writing, this key will never dispatch again.
      try {
        try {
          await requireRemoteTool(actor, definition);
          const result =
            operation.request.kind === "mcp"
              ? await invokeMcp(
                  connection.endpoint,
                  token,
                  operation,
                  decoded,
                  async () => {
                    await requireRemoteTool(actor, definition);
                  }
                )
              : await invokeOpenApi(
                  connection.endpoint,
                  token,
                  operation,
                  decoded,
                  id
                );
          const text = JSON.stringify(result);
          const clean = await jsonString(
            z.record(z.string(), z.unknown())
          ).parseAsync(redactConnectorCredential(text, token));
          const output = await decodeCustomerValue(
            operation.outputSchema,
            clean,
            true
          );
          await withDatabaseTransaction(async () => {
            await requireRemoteTool(actor, definition);
            const active =
              await query(sql`SELECT id FROM tool_connections WHERE id = ${connection.id} AND revision = ${connection.revision}
        AND revoked_at IS NULL FOR SHARE`);
            if (!active.length) throw new ConnectorError({ reason: "changed" });
            await query(sql`UPDATE tool_invocations SET result = ${JSON.stringify(output)}::jsonb, status = 'completed', completed_at = now()
        WHERE id = ${id} AND status = 'started'`);
            return undefined;
          });
          return output;
        } catch (error) {
          await query(
            sql`UPDATE tool_invocations SET status = 'uncertain' WHERE id = ${id} AND status = 'started'`
          );
          throw error;
        }
      } catch {
        throw new ConnectorError({ reason: "uncertain" });
      }
    }, 35_000);
  } finally {
    remoteRequests.delete(slot.promise);
    slot.resolve();
  }
};
