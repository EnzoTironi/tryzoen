import { defineDynamic, defineSkill } from "eve/skills";
import { resolveModeValue } from "../lib/mode";
import { workspaceActorFromPrincipal } from "../../server/workspaces/access";
import { resolveCapabilities } from "../../server/tools/catalog";
import {
  readPublishedSkills,
  resolvePublishedSkill,
} from "../../server/tools/skills";

export default defineDynamic({
  events: {
    "turn.started": async (_event, context) => {
      if (resolveModeValue(context, { "scheduled-report": true })) return null;
      const principal =
        context.session.auth.current ?? context.session.auth.initiator;
      if (!principal) return null;
      const actor = await workspaceActorFromPrincipal(principal);
      const available = Object.keys(await resolveCapabilities(context));
      const published = await readPublishedSkills(actor);
      const skills = published.map((skill) => {
        const loaded = resolvePublishedSkill(skill, available);
        const markdown =
          loaded.execution === "instructions"
            ? loaded.instructions
            : `This procedure is unavailable. ${"problem" in loaded ? loaded.problem : `Missing tools: ${loaded.missing.join(", ")}.`} Do not execute its steps.`;
        return [
          skill.id,
          defineSkill({
            description: skill.description,
            markdown: `${loaded.authority}\nPublished revision: ${loaded.revision}.\n\n${markdown}`,
          }),
        ] as const;
      });
      return Object.fromEntries(skills);
    },
  },
});
