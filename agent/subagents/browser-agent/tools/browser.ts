import { defineDynamic } from "eve/tools";
import { resolveBrowserTools } from "../../../../server/tools/browser/catalog";

export default defineDynamic({
  events: {
    "turn.started": (_event, context) => resolveBrowserTools(context),
  },
});
