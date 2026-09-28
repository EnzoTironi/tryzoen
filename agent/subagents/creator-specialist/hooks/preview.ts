import { defineHook } from "eve/hooks";
import { previewOrigin } from "../lib/preview";

export default defineHook({
  events: {
    "turn.started": (_event, context) => {
      const parent = context.session.parent;
      previewOrigin.update(() =>
        parent ? { sessionId: parent.sessionId, turnId: parent.turn.id } : null
      );
    },
  },
});
