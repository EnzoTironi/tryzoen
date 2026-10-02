import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
export default defineTool({
  description: "Synthetic action that must retain human approval.",
  inputSchema: z.strictObject({}),
  approval: { request: always() },
  execute: () => ({ executed: true }),
});
