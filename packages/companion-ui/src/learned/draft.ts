import type { z } from "zod";
import type {
  LearnedClaimChangeSchema,
  LearnedClaimReadSchema,
  LearnedClaimVersionSchema,
} from "./schema";

export type LearnedClaimEdit = Extract<
  z.output<typeof LearnedClaimChangeSchema>,
  { body: unknown }
>;

export function createLearnedClaimEdit(
  memory: z.output<typeof LearnedClaimReadSchema>,
  newId: () => string,
  claim?: z.output<typeof LearnedClaimVersionSchema>
): LearnedClaimEdit {
  if (claim) {
    if (claim.file.state.kind !== "active")
      throw new Error("This memory was removed. Your draft cannot restore it.");
    return {
      action: "correct",
      claimId: claim.file.id,
      expectedRevision: memory.snapshot.revision,
      operationId: newId(),
      body: structuredClone(claim.file.state.body),
    };
  }
  return {
    action: "assert",
    claimId: newId(),
    expectedRevision: memory.snapshot.revision,
    operationId: newId(),
    body: { text: "", sources: [], validTime: null, relations: [] },
  };
}

/** Unchanged retries reuse identity. Changing a submitted command needs a new ID. */
export function updateLearnedClaimText(
  draft: LearnedClaimEdit,
  text: string,
  newId: () => string
): LearnedClaimEdit {
  return draft.body.text === text
    ? draft
    : { ...draft, operationId: newId(), body: { ...draft.body, text } };
}

/** Called only after explicit review; never silently rebase a failed command. */
export function reviewLearnedClaimEdit(
  draft: LearnedClaimEdit,
  memory: z.output<typeof LearnedClaimReadSchema>,
  edited: "text" | "relations",
  newId: () => string
): LearnedClaimEdit {
  const current = memory.snapshot.claims.find(
    (claim) => claim.file.id === draft.claimId
  );
  if (draft.action === "assert" && !current)
    return {
      ...draft,
      expectedRevision: memory.snapshot.revision,
      operationId: newId(),
    };
  if (current?.file.state.kind !== "active")
    throw new Error(
      "This memory was removed. Your draft is retained, but cannot restore it."
    );
  const body = structuredClone(current.file.state.body);
  return {
    ...draft,
    action: "correct",
    expectedRevision: memory.snapshot.revision,
    operationId: newId(),
    body:
      edited === "text"
        ? { ...body, text: draft.body.text }
        : { ...body, relations: draft.body.relations },
  };
}
