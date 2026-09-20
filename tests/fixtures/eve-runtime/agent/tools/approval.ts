import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
export default defineTool({
  description: "Native approval probe",
  inputSchema: z.strictObject({ text: z.string() }),
  approval: always(),
  execute: (input) => input,
});
