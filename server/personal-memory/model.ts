import { z } from "zod";
import type { UserProfile } from "@shared/user-profile/schema";

export const storedNoteSchema = z.object({
  content: z.string(),
  version: z.uuid(),
  updatedAt: z.string(),
});

export interface PersonalMemorySnapshot {
  readonly scope: "stored-personal-memory";
  readonly generatedAt: string;
  readonly profile: UserProfile;
  readonly notes: {
    readonly status: "located" | "unresolved";
    readonly documents: readonly z.output<typeof storedNoteSchema>[];
  };
  readonly coverage: {
    readonly included: readonly ["structured-profile", "bound-profile-notes"];
    readonly excluded: readonly [
      "conversation-history",
      "artifacts",
      "connected-accounts",
      "schedules",
      "unbound-memory-documents",
    ];
  };
}
