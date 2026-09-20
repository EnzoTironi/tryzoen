import { webFetch } from "eve/tools/web_fetch";
import { defineDynamic, defineTool } from "eve/tools";
import { resolveModeValue } from "../../../agent/lib/mode";

const fetchPage = defineTool({
  description: webFetch.description,
  inputSchema: webFetch.inputSchema,
  execute(input, context) {
    return webFetch.execute(input, context);
  },
});

export default defineDynamic({
  events: {
    "turn.started": (_event, context) =>
      resolveModeValue(context, {
        interactive: fetchPage,
        "scheduled-worker": fetchPage,
      }),
  },
});
