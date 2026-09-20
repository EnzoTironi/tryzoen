import { z } from "zod";
import type { DynamicResolveContext, ToolContext } from "eve/tools";
import { resolveCapabilities } from "../../server/tools/catalog";
import workspaceSkills from "@agent/tools/workspace-skills";
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
  const tools = await workspaceSkills.events["turn.started"]?.(
    {},
    nativeContext(execution)
  );
  const load = tools?.workspace_skills_load;
  if (!load) throw new Error("Workspace procedures unavailable.");
  if (!(load.inputSchema instanceof z.ZodType))
    throw new Error("Expected an authored Zod schema");
  await load.inputSchema.parseAsync({ path });
  const loaded = await load.execute(
    { path },
    {
      ...execution,
      toolName: "workspace_skills_load",
    }
  );
  if (Symbol.asyncIterator in loaded)
    throw new Error("Expected a complete workspace procedure result.");
  return loaded;
}
