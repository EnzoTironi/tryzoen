import { defineHook } from "eve/hooks";
import owner from "../../../../../agent/hooks/session-owner";

export default defineHook({
  events: {
    async "session.started"(event, context) {
      if (context.session.auth.current?.attributes.archiveProof !== "enabled")
        return;
      const capture = owner.events?.["session.started"];
      if (!capture) throw new Error("The real session owner hook is required.");
      await capture(event, context);
    },
  },
});
