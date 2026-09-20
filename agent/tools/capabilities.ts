import { defineDynamic } from "eve/tools";
import { resolveCapabilities } from "../../server/tools/catalog";

export default defineDynamic({
  events: {
    "turn.started": (_event, context) => resolveCapabilities(context),
  },
});
