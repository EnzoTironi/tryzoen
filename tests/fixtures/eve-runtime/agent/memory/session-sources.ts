import { defineMemory } from "eve/memory";
import archive from "../../../../../agent/memory/session-sources";

export default defineMemory({
  description: archive.description,
  namespace: archive.namespace,
  visibility: archive.visibility,
  provider: archive.provider,
  scope: (context) =>
    context.session.auth.current?.attributes.archiveProof === "enabled"
      ? archive.scope(context)
      : null,
});
