import { transaction } from "@db/queries";
import { withSignal } from "../../server/operations/async";
import {
  MemoryDocumentConflict,
  MemoryDocuments,
} from "../../server/memory/documents";
import {
  MemoryDocumentConflictError,
  type MemoryDocumentBackend,
} from "eve/memory/file";

export function createMemoryDocumentBackend(
  authorize: () => Promise<void>
): MemoryDocumentBackend {
  return {
    read: ({ key, signal }) =>
      withSignal(signal, () =>
        transaction(async () => {
          await authorize();
          return MemoryDocuments.read(key);
        })
      ),
    write: ({ key, content, expectedVersion, signal }) =>
      withSignal(signal, async () => {
        try {
          return await transaction(async () => {
            await authorize();
            return MemoryDocuments.write({ key, content, expectedVersion });
          });
        } catch (error) {
          if (error instanceof MemoryDocumentConflict)
            throw new MemoryDocumentConflictError(error.key);
          throw error;
        }
      }),
  };
}
