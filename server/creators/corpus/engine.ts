import { z } from "zod";
import { env } from "../../../shared/environment/env";
import { openMemoryEngine } from "../../memory/ai-memory/engine";
import { memoryTool } from "../../memory/ai-memory/protocol";
import { operationSignal } from "../../operations/async";
import { corpusDigest, corpusPageSchema } from "./schema";

export async function openCreatorCorpus(
  namespace: string,
  initialized: boolean
) {
  if (!env.ZOEN_AI_MEMORY_BINARY || !env.ZOEN_SESSION_ARCHIVE_DIR)
    throw new Error(
      "Creator knowledge indexing is not configured on this installation."
    );
  return openMemoryEngine(
    env.ZOEN_AI_MEMORY_BINARY,
    env.ZOEN_SESSION_ARCHIVE_DIR,
    namespace,
    "creator-knowledge",
    { requireExisting: initialized }
  );
}
export function creatorCorpusTool(
  engine: Awaited<ReturnType<typeof openCreatorCorpus>>,
  releaseId: string,
  name: string,
  args: Record<string, unknown>
) {
  operationSignal().throwIfAborted();
  return memoryTool(
    engine.client,
    name,
    { ...args, workspace: "zoen-creators", project: releaseId },
    { signal: operationSignal() }
  );
}
export async function readCreatorCorpusPage(
  engine: Awaited<ReturnType<typeof openCreatorCorpus>>,
  releaseId: string,
  expected: z.infer<typeof corpusPageSchema>
) {
  const page = z
    .object({
      path: corpusPageSchema.shape.path,
      body: z.string().max(8000),
      served_from: z.never().optional(),
    })
    .parse(
      await creatorCorpusTool(engine, releaseId, "memory_read_page", {
        path: expected.path,
      })
    );
  if (
    page.path !== expected.path ||
    page.body !== expected.body ||
    corpusDigest(page.body) !== expected.digest
  )
    throw new Error("Creator knowledge page failed source verification.");
  return page;
}
