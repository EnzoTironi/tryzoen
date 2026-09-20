import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { applicationOrigin } from "@shared/environment/origin";
import { authenticateAgentGrant } from "../workspaces/bots";
import { WorkspaceAccessDenied } from "../workspaces/access";

export const readAgentCard = async function (
  username: string,
  authorization: string | null
) {
  const rows = await query(
    sql`SELECT name, description, discoverable FROM workspace_bots WHERE username = ${username}`
  );
  if (!rows[0]) throw new WorkspaceAccessDenied();
  const bot = await z
    .object({
      name: z.string(),
      description: z.string(),
      discoverable: z.boolean(),
    })
    .parseAsync(rows[0]);
  if (!bot.discoverable) await authenticateAgentGrant(authorization, username);
  return {
    name: bot.name,
    description: bot.description || "Zoen workspace knowledge assistant",
    version: "1.0.0",
    supportedInterfaces: [
      {
        url: `${applicationOrigin()}/agents/${username}`,
        protocolBinding: "JSONRPC",
        protocolVersion: "1.0",
      },
    ],
    capabilities: { streaming: false, pushNotifications: false },
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    securitySchemes: {
      bearer: { httpAuthSecurityScheme: { scheme: "bearer" } },
    },
    securityRequirements: [{ schemes: { bearer: { list: [] } } }],
    skills: [
      {
        id: "workspace-knowledge",
        name: "Workspace knowledge",
        description:
          "Consult explicitly shared documents and structured knowledge within an expiring, revocable grant.",
        tags: ["knowledge", "workspace"],
      },
    ],
  };
};
