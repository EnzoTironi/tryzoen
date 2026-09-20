import type { ToolDefinition } from "eve/tools";

// A heterogeneous catalog retains the owner schemas. Inputs and projections are
// callable only after their owning schema/implementation has established the type.
type PublishedTool = Pick<
  ToolDefinition<never, never>,
  "description" | "approval" | "toModelOutput"
> &
  Pick<ToolDefinition, "inputSchema" | "outputSchema"> & {
    execute: (...args: Parameters<ToolDefinition<never>["execute"]>) => unknown;
  };

export type ToolGroup = Readonly<Record<string, PublishedTool | undefined>>;
export type ToolCatalog = Readonly<Record<string, PublishedTool>>;
