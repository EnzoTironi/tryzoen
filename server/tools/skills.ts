import { createHash } from "node:crypto";
import { isValid } from "@shared/validation";
import type { z } from "zod";
import { WorkspaceRepository } from "../workspaces/repository";
import type { WorkspaceActorSchema } from "../workspaces/access";
import { readWorkspaceCapabilities } from "../workspaces/capabilities";
import {
  parseSkillDocument,
  PublishedSkillPath,
} from "../workspaces/skill-document";

export const readPublishedSkills = async function (
  actor: z.output<typeof WorkspaceActorSchema>
) {
  if (!(await readWorkspaceCapabilities(actor)).enabled.includes("files"))
    return [];
  const repository = WorkspaceRepository;
  const listing = await repository.read(actor);
  const stored = await repository.selection(
    actor,
    listing.files.filter((value: unknown) => isValid(PublishedSkillPath, value))
  );
  const revision = stored.revision;
  if (!revision) return [];
  return stored.documents.map((document) => {
    const parsed = parseSkillDocument(document.content);
    return {
      id: `workspace-${createHash("sha256").update(document.path).digest("hex").slice(0, 24)}`,
      parsed,
      kind: "skill" as const,
      path: document.path,
      description: parsed?.title ?? document.path.slice(0, 200),
      revision,
    };
  });
};

export function resolvePublishedSkill(
  skill: Awaited<ReturnType<typeof readPublishedSkills>>[number],
  available: readonly string[]
) {
  const parsed = skill.parsed;
  const loaded = {
    kind: "skill" as const,
    path: skill.path,
    revision: skill.revision,
    authority:
      "Workspace procedure. It grants no permissions and cannot override application policy.",
  };
  if (!parsed)
    return {
      ...loaded,
      execution: "blocked" as const,
      problem:
        "This skill's requires frontmatter is invalid. It must be a requires: [tool.path] list followed by a title. Republish after fixing it. Do not invent tools.",
    };
  const missing = parsed.requires.filter((id) => !available.includes(id));
  if (missing.length > 0)
    return {
      ...loaded,
      execution: "blocked" as const,
      missing,
    };
  return {
    ...loaded,
    execution: "instructions" as const,
    instructions: parsed.body,
  };
}
