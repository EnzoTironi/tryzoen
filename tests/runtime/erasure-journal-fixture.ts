import { beforeEach, vi } from "vitest";
import { ErasureJournal } from "../../server/accounts/erasure-journal";

/** Independent storage survives the database restoration exercised by deletion tests. */
export function installErasureJournalFixture() {
  beforeEach(() => {
    const users = new Set<string>();
    vi.spyOn(ErasureJournal, "append").mockImplementation(async (userId) => {
      users.add(userId);
    });
    vi.spyOn(ErasureJournal, "read").mockImplementation(async () =>
      [...users].map((userId) => ({ userId }))
    );
  });
}
