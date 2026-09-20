import type { DynamicResolveContext } from "eve/tools";
import type { ToolCatalog } from "../definition";
import { ToolUnavailable } from "../errors";
import { requireWorkerScope } from "@agent/subagents/browser-agent/lib/access";
import manageBrowsers from "./manage_browsers";
import computerAction from "./computer_action";
import captureImage from "./capture_browser_image";
import fillVault from "./fill_from_vault";
import listVault from "./list_vault";
import semantic from "./semantic_browser";

export const resolveBrowserTools = async function (
  context: DynamicResolveContext
) {
  await Promise.try(async () => requireWorkerScope(context)).catch(() => {
    throw new ToolUnavailable({ reason: "unavailable" });
  });
  const browser = await Promise.try(async () =>
    semantic.events["session.started"]?.(undefined, context)
  ).catch(() => {
    throw new ToolUnavailable({ reason: "unavailable" });
  });
  const tools: ToolCatalog = {
    manage_browsers: manageBrowsers,
    computer_action: computerAction,
    capture_browser_image: captureImage,
    fill_from_vault: fillVault,
    list_vault: listVault,
    ...browser,
  };
  return tools;
};
