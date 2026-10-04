import type { z } from "zod";
import type {
  LearnedClaimBodySchema,
  LearnedClaimFileSchema,
} from "../../packages/companion-ui/src/learned/claim";
import type { WorkspaceActorSchema } from "../workspaces/access";
import { WorkspaceRepository } from "../workspaces/repository";
import { verifySessionClaimSource } from "./session-export";
import { PrivateMemoryError } from "./errors";

/** Source formatting never establishes access. Current recall also withholds
 * claims whose cited passage has changed; explicit audit keeps recorded facts. */
export async function verifyEvidence(
  actor: z.infer<typeof WorkspaceActorSchema>,
  files: readonly z.infer<typeof LearnedClaimFileSchema>[],
  current: boolean
) {
  const sources = files.flatMap((file) =>
    file.state.kind === "active" ? file.state.body.sources : []
  );
  return verifySources(actor, sources, current);
}

export async function verifySources(
  actor: z.infer<typeof WorkspaceActorSchema>,
  sources: readonly z.infer<typeof LearnedClaimBodySchema>["sources"][number][],
  current: boolean
) {
  for (const source of sources.filter((item) => item.kind === "session"))
    if (!(await verifySessionClaimSource(actor, source)))
      throw new PrivateMemoryError("invalid_input");
  const filesSources = sources.filter((source) => source.kind === "file");
  for (const revision of new Set(
    filesSources.map((source) => source.revision)
  )) {
    const citations = filesSources.filter(
      (source) => source.revision === revision
    );
    const paths = [...new Set(citations.map((source) => source.path))];
    for (let offset = 0; offset < paths.length; offset += 24) {
      const selected = paths.slice(offset, offset + 24);
      const recorded = await WorkspaceRepository.selection(actor, selected, {
        revision,
      });
      const latest = current
        ? await WorkspaceRepository.selection(actor, selected)
        : recorded;
      for (const source of citations.filter((item) =>
        selected.includes(item.path)
      )) {
        if (
          !recorded.documents
            .find((item) => item.path === source.path)
            ?.content.includes(source.excerpt) ||
          !latest.documents
            .find((item) => item.path === source.path)
            ?.content.includes(source.excerpt)
        )
          throw new PrivateMemoryError("invalid_input");
      }
    }
  }
}
