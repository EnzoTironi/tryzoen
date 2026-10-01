import type { z } from "zod";
import type {
  LearnedClaimChangeSchema,
  LearnedClaimChangeResultSchema,
  LearnedClaimHistoryInputSchema,
  LearnedClaimHistorySchema,
  LearnedClaimReadInputSchema,
  LearnedClaimReadSchema,
  LearnedClaimSearchInputSchema,
  LearnedClaimSearchSchema,
  LearnedClaimSetEnabledInputSchema,
  LearnedClaimSetEnabledResultSchema,
  PrivateMemoryArchivePreviewSchema,
  PrivateMemoryArchiveRestoreResultSchema,
} from "./schema";

/** The platform holds the inspected file until apply or explicit dismissal. */
export interface MemoryArchiveReview {
  readonly preview: z.output<typeof PrivateMemoryArchivePreviewSchema>;
  readonly apply: () => Promise<
    z.output<typeof PrivateMemoryArchiveRestoreResultSchema>
  >;
  readonly dispose: () => Promise<void>;
}

export interface LearnedNotesData {
  readonly read: (
    input?: z.input<typeof LearnedClaimReadInputSchema>
  ) => Promise<z.output<typeof LearnedClaimReadSchema>>;
  readonly search: (
    input: z.input<typeof LearnedClaimSearchInputSchema>
  ) => Promise<z.output<typeof LearnedClaimSearchSchema>>;
  readonly history: (
    input: z.input<typeof LearnedClaimHistoryInputSchema>
  ) => Promise<z.output<typeof LearnedClaimHistorySchema>>;
  readonly change: (
    input: z.input<typeof LearnedClaimChangeSchema>
  ) => Promise<z.output<typeof LearnedClaimChangeResultSchema>>;
  readonly setEnabled: (
    input: z.input<typeof LearnedClaimSetEnabledInputSchema>
  ) => Promise<z.output<typeof LearnedClaimSetEnabledResultSchema>>;
  readonly archives: {
    readonly backup: () => Promise<void>;
    readonly inspect: () => Promise<MemoryArchiveReview | null>;
  };
  readonly newOperationId: () => string;
}

export function isLearnedMemoryConflict(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "data" in error &&
    typeof error.data === "object" &&
    error.data !== null &&
    "code" in error.data &&
    error.data.code === "CONFLICT"
  );
}
