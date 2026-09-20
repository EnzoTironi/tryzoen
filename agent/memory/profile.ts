import { defineMemory } from "eve/memory";
import { resolveProfileMemoryScope } from "../lib/profile-memory";
import { personalMemoryProvider } from "../../server/tools/memory/personal-memory-provider";

export default defineMemory({
  description:
    "Personal notes explicitly saved by the user. Keep concise preferences and reusable facts here; learned memory captures context separately. Never store secrets.",
  provider: personalMemoryProvider,
  scope: resolveProfileMemoryScope,
});
