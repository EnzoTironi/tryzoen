import { defineMemory } from "eve/memory";
import workstreams from "../../../../../agent/memory/workstreams";

export default defineMemory({
  description: workstreams.description,
  provider: workstreams.provider,
  scope: (context) =>
    context.session.auth.current?.attributes.memoryProof === "enabled"
      ? workstreams.scope(context)
      : null,
});
