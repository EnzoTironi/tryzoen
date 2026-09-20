import { mapAsync } from "../operations/async";
import type { DynamicResolveContext } from "eve/tools";
import type { ToolCatalog, ToolGroup } from "./definition";
import { resolveModeValue } from "@agent/lib/mode";
import { workspaceActorFromPrincipal } from "../workspaces/access";
import { readWorkspaceCapabilities } from "../workspaces/capabilities";
import artifacts from "./tools/artifacts";
import calendar from "./tools/calendar";
import contacts from "./tools/contacts";
import network from "./tools/network";
import device from "./tools/device-auth";
import gmail from "./tools/gmail";
import ontology from "./tools/ontology";
import personalMemory from "./tools/personal-memory";
import schedules from "./tools/schedules";
import vault from "./tools/vault";
import whatsapp from "./tools/whatsapp";
import webFetch from "./tools/web_fetch";
import workspace from "./tools/workspace";
import { ToolUnavailable } from "./errors";
import { resolveWorkspaceTools } from "./workspace";
import { resolveCustomerTools } from "./customer-tools";

const modules: readonly {
  events: {
    "turn.started"?: (
      event: Parameters<
        NonNullable<(typeof artifacts.events)["turn.started"]>
      >[0],
      context: DynamicResolveContext
    ) => ToolGroup | null | Promise<ToolGroup | null>;
  };
}[] = [
  artifacts,
  calendar,
  contacts,
  network,
  device,
  gmail,
  ontology,
  personalMemory,
  schedules,
  vault,
  whatsapp,
  workspace,
];

export const resolveCapabilities = async function (
  context: DynamicResolveContext
) {
  const principal =
    context.session.auth.current ?? context.session.auth.initiator;
  if (!principal) throw new ToolUnavailable({ reason: "unavailable" });
  // Scheduled result turns have a lease-bound reporting identity, not a user workspace.
  const reporting =
    resolveModeValue(context, { "scheduled-report": true }) === true;
  const capabilities = reporting
    ? null
    : await readWorkspaceCapabilities(
        await workspaceActorFromPrincipal(principal)
      );
  const groups = await mapAsync(
    modules,
    async (module) => {
      try {
        return await (module.events["turn.started"]?.(undefined, context) ??
          {});
      } catch {
        throw new ToolUnavailable({ reason: "unavailable" });
      }
    },
    1
  );
  const fetchTool = await Promise.try(async () =>
    webFetch.events["turn.started"]?.(undefined, context)
  ).catch(() => {
    throw new ToolUnavailable({ reason: "unavailable" });
  });
  const tools: ToolCatalog = Object.fromEntries<ToolCatalog[string]>([
    ...Object.entries<ToolCatalog[string]>(
      reporting ? {} : await resolveCustomerTools(context)
    ),
    ...Object.entries(reporting ? {} : await resolveWorkspaceTools(context)),
    ...groups.flatMap((group) =>
      Object.entries(group ?? {}).flatMap(([name, tool]) =>
        tool ? [[name, tool] as const] : []
      )
    ),
    ...(fetchTool ? [["web_fetch", fetchTool] as const] : []),
  ]);
  return Object.fromEntries(
    Object.entries(tools).filter(([name]) => {
      if (/^(gmail-|calendar-|contacts-)/u.test(name))
        return capabilities?.enabled.includes("google") === true;
      if (name === "ontology-action")
        return capabilities?.enabled.includes("ontology") === true;
      return true;
    })
  );
};
