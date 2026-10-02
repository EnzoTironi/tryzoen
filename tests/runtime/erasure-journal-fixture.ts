import { beforeEach, vi } from "vitest";
import { ErasureJournal } from "../../server/accounts/erasure-journal";

/** Immutable full records survive restoration independently of the database. */
export function installErasureJournalFixture() {
  beforeEach(() => {
    const records = new Map<
      string,
      Parameters<typeof ErasureJournal.append>[0]
    >();
    vi.spyOn(ErasureJournal, "append").mockImplementation(async (input) => {
      const bytes = JSON.stringify(input);
      records.set(bytes, structuredClone(input));
    });
    vi.spyOn(ErasureJournal, "read").mockImplementation(
      async function* (userId) {
        // A read snapshots immutable objects; consumer work is awaited between records.
        const snapshot = [...records.values()];
        for (const record of snapshot)
          if (userId === undefined || userId === record.userId)
            yield { version: 1, ...structuredClone(record) };
      }
    );
  });
}
