import { z } from "zod";
import type { DynamicResolveContext, ToolContext } from "eve/tools";
import { resolveCapabilities } from "../../server/tools/catalog";
import {
  readPublishedSkills,
  resolvePublishedSkill,
} from "../../server/tools/skills";
import { workspaceActorFromPrincipal } from "../../server/workspaces/access";
export function nativeContext(
  execution: Pick<ToolContext, "session">
): DynamicResolveContext {
  return {
    session: execution.session,
    model: null,
    channel: {
      kind: "eve",
    },
    messages: [],
  };
}

/** Exercise the same owner schema and executor that Eve invokes after admission. */
export async function callNativeTool(
  execution: ToolContext,
  name: string,
  input: unknown
) {
  const tool = (await resolveCapabilities(nativeContext(execution)))[name];
  if (!tool) throw new Error(`Tool unavailable: ${name}`);
  if (!(tool.inputSchema instanceof z.ZodType))
    throw new Error("Expected an authored Zod schema");
  const inputValue: unknown = await tool.inputSchema.parseAsync(input);
  // SAFETY: the schema above validated the input of this exact heterogeneous tool.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The schema or pinned SDK contract establishes this boundary.
  return tool.execute(inputValue as never, {
    ...execution,
    toolName: name,
  });
}
export async function readNativeSkill(execution: ToolContext, path: string) {
  const actor = await workspaceActorFromPrincipal(
    execution.session.auth.current ??
      execution.session.auth.initiator ??
      undefined
  );
  const skill = (await readPublishedSkills(actor)).find(
    (localSkill) => localSkill.path === path
  );
  if (!skill) throw new Error("Skill unavailable");
  return resolvePublishedSkill(
    skill,
    Object.keys(await resolveCapabilities(nativeContext(execution)))
  );
}
