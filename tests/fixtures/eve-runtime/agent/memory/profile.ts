import { defineMemory } from "eve/memory";
import profile from "../../../../../agent/memory/profile";

export default defineMemory({
  description: profile.description,
  provider: profile.provider,
  scope: (context) =>
    context.session.auth.current?.attributes.memoryProof === "enabled" ||
    context.session.auth.current?.authenticator === "matrix"
      ? profile.scope(context)
      : null,
});
