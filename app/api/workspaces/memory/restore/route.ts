import { z } from "zod";
import { transaction } from "../../../../../db/queries";
import {
  withDeadline,
  withSignal,
} from "../../../../../server/operations/async";
import { resolveWorkspaceActor } from "../../../../../server/workspaces/session";
import {
  inspectPrivateMemoryArchive,
  PrivateMemoryRepository,
} from "../../../../../server/memory/repository";
import { decodePrivateMemoryArchive } from "../../../../../server/memory/archive-codec";
import {
  privateMemoryArchiveDigest,
  PrivateMemoryArchiveError,
} from "../../../../../server/memory/archive";
import {
  memoryArchiveFailureResponse,
  readPrivateMemoryArchiveRequest,
} from "../../../../../server/memory/archive-http";
import {
  PrivateMemoryArchiveApplySchema,
  PrivateMemoryArchiveRestoreResultSchema,
} from "@zoen/companion-ui/memory";

export async function POST(request: Request) {
  return withDeadline(
    () =>
      withSignal(request.signal, async () => {
        const parameters = new URL(request.url).searchParams;
        const mode = z.enum(["inspect", "apply"]).parse(parameters.get("mode"));
        const headers = new Headers(request.headers);
        const space = parameters.get("space");
        if (space) headers.set("x-zoen-workspace", space);
        const actor = await transaction(() => resolveWorkspaceActor(headers), {
          outermost: true,
        });
        const bytes = await readPrivateMemoryArchiveRequest(request);
        if (mode === "inspect")
          return Response.json(
            await inspectPrivateMemoryArchive(actor, bytes),
            { headers: { "cache-control": "private, no-store" } }
          );
        if (!parameters.has("expectedRevision"))
          throw new PrivateMemoryArchiveError("invalid_input");
        const input = PrivateMemoryArchiveApplySchema.parse({
          expectedRevision: parameters.get("expectedRevision") || null,
          archiveDigest: parameters.get("archiveDigest"),
        });
        if (privateMemoryArchiveDigest(bytes) !== input.archiveDigest)
          throw new PrivateMemoryArchiveError("invalid_input");
        const archive = decodePrivateMemoryArchive(bytes);
        const result =
          archive.version === 2
            ? await PrivateMemoryRepository.restore(actor, {
                expectedRevision: input.expectedRevision,
                archive,
              })
            : await PrivateMemoryRepository.restoreCorpus(actor, {
                expectedRevision: input.expectedRevision,
                archive,
              });
        return Response.json(
          PrivateMemoryArchiveRestoreResultSchema.parse(result),
          { headers: { "cache-control": "private, no-store" } }
        );
      }),
    Date.now() + 60_000
  ).catch(memoryArchiveFailureResponse);
}
