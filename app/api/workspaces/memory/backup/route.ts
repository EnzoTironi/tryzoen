import { transaction } from "../../../../../db/queries";
import { PrivateMemoryArchiveCoverageSchema } from "@zoen/companion-ui/memory";
import {
  withDeadline,
  withSignal,
} from "../../../../../server/operations/async";
import { resolveWorkspaceActor } from "../../../../../server/workspaces/session";
import { PrivateMemoryRepository } from "../../../../../server/memory/repository";
import {
  privateMemoryArchiveResponse,
  memoryArchiveFailureResponse,
} from "../../../../../server/memory/archive-http";

export async function GET(request: Request) {
  return withDeadline(
    () =>
      withSignal(request.signal, async () => {
        const parameters = new URL(request.url).searchParams;
        const coverage = PrivateMemoryArchiveCoverageSchema.parse(
          parameters.get("coverage") ?? "complete-journal"
        );
        const headers = new Headers(request.headers);
        const space = parameters.get("space");
        if (space) headers.set("x-zoen-workspace", space);
        const actor = await transaction(() => resolveWorkspaceActor(headers), {
          outermost: true,
        });
        const archive =
          coverage === "claims"
            ? await PrivateMemoryRepository.backup(actor)
            : await PrivateMemoryRepository.backupCorpus(actor);
        return privateMemoryArchiveResponse(archive);
      }),
    Date.now() + 60_000
  ).catch(memoryArchiveFailureResponse);
}
