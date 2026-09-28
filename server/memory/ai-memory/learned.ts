import { env } from "@shared/environment/env";
import {
  acceptMemoryCorpus,
  memoryCorpusInitialized,
} from "@db/services/memory-corpora";
import { z } from "zod";
import type {
  LearnedMemoryWriteSchema,
  learnedMemoryHistoryInputSchema,
} from "@zoen/companion-ui/memory";
import { openMemoryEngine } from "./engine";
import { readNotes, readNoteHistory } from "./notes";
import { FileMemoryError, mutateNotes } from "./mutations";

async function withLearnedCorpus<Result>(
  namespace: string,
  run: (
    engine: Awaited<ReturnType<typeof openMemoryEngine>>
  ) => Promise<Result>,
  requireExisting = false
) {
  if (!env.ZOEN_SESSION_ARCHIVE_DIR || !env.ZOEN_AI_MEMORY_BINARY)
    throw new FileMemoryError("unconfigured");
  try {
    await using engine = await openMemoryEngine(
      env.ZOEN_AI_MEMORY_BINARY,
      env.ZOEN_SESSION_ARCHIVE_DIR,
      z.uuid().parse(namespace),
      "learned-memory",
      {
        requireExisting:
          (await memoryCorpusInitialized(namespace, "learned-memory")) ||
          requireExisting,
      }
    );
    const result = await run(engine);
    await acceptMemoryCorpus(namespace, "learned-memory");
    return result;
  } catch (error) {
    if (error instanceof FileMemoryError) throw error;
    throw new FileMemoryError("unavailable");
  }
}

/** Call only under the authorized namespace's database lock. No client-supplied paths or scopes. */
export const FileMemory = {
  recover(namespace: string) {
    return withLearnedCorpus(
      namespace,
      async (engine) => {
        await readNotes(engine);
        await engine.checkpoint();
      },
      true
    );
  },
  history(
    namespace: string,
    input: z.infer<typeof learnedMemoryHistoryInputSchema>
  ) {
    return withLearnedCorpus(namespace, (engine) =>
      readNoteHistory(engine, input)
    );
  },
  read(namespace: string, query?: string) {
    return withLearnedCorpus(namespace, (engine) => readNotes(engine, query));
  },
  mutate(namespace: string, input: z.infer<typeof LearnedMemoryWriteSchema>) {
    return withLearnedCorpus(namespace, (engine) =>
      mutateNotes(engine, namespace, input)
    );
  },
};
