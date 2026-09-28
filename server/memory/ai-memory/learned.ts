import { env } from "@shared/environment/env";
import { z } from "zod";
import type { LearnedMemoryWriteSchema } from "@shared/companion/learned-memory";
import { openMemoryEngine } from "./engine";
import { readNotes } from "./notes";
import { FileMemoryError, mutateNotes } from "./mutations";

async function withLearnedCorpus<Result>(
  namespace: string,
  run: (engine: Awaited<ReturnType<typeof openMemoryEngine>>) => Promise<Result>
) {
  if (!env.ZOEN_SESSION_ARCHIVE_DIR || !env.ZOEN_AI_MEMORY_BINARY)
    throw new FileMemoryError("unconfigured");
  try {
    await using engine = await openMemoryEngine(
      env.ZOEN_AI_MEMORY_BINARY,
      env.ZOEN_SESSION_ARCHIVE_DIR,
      z.uuid().parse(namespace),
      "learned-memory"
    );
    return await run(engine);
  } catch (error) {
    if (error instanceof FileMemoryError) throw error;
    throw new FileMemoryError("unavailable");
  }
}

/** Call only under the authorized namespace's database lock. No client-supplied paths or scopes. */
export const FileMemory = {
  read(namespace: string, query?: string) {
    return withLearnedCorpus(namespace, (engine) => readNotes(engine, query));
  },
  mutate(namespace: string, input: z.infer<typeof LearnedMemoryWriteSchema>) {
    return withLearnedCorpus(namespace, (engine) =>
      mutateNotes(engine, namespace, input)
    );
  },
};
