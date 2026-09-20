import type { DynamicResolveContext } from "eve/tools";
import type { ToolCatalog } from "../definition";
import { assertLiveWorkerAuthority } from "@agent/subagents/browser-agent/lib/live-authority";
import manageBrowsers from "./manage_browsers";
import computerAction from "./computer_action";
import captureImage from "./capture_browser_image";
import fillVault from "./fill_from_vault";
import listVault from "./list_vault";
import semantic from "./semantic_browser";

export const resolveBrowserTools = async function (
  context: DynamicResolveContext
) {
  const caller = context.session.auth.current ?? context.session.auth.initiator;
  if (!caller) throw new Error("An authenticated user is required.");
  // Dynamic resolvers expose identity and auth, not parent lineage. Each tool
  // verifies the full delegated session and its ownership again on execution.
  await assertLiveWorkerAuthority(caller);
  const browser = await semantic.events["session.started"]?.(
    undefined,
    context
  );
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
