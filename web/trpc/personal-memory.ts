import { TRPCError } from "@trpc/server";
import { PersonalNoteInvalid } from "@shared/personal-memory/document";
import {
  personalMemorySnapshotSchema,
  personalNoteUpdateSchema,
} from "@shared/personal-memory/schema";
import { inspectPersonalMemory } from "../../server/personal-memory/export";
import { PersonalMemoryError } from "../../server/personal-memory/access";
import {
  PersonalNoteChanged,
  updatePersonalNote,
} from "../../server/personal-memory/notes";
import { withSignal } from "../../server/operations/async";
import { protectedProcedure } from "./init";

const personalProcedure = protectedProcedure.use(async ({ next }) => {
  const result = await next();
  if (!result.ok) {
    const cause = result.error.cause;
    if (cause instanceof PersonalNoteInvalid)
      throw new TRPCError({ code: "BAD_REQUEST", message: cause.message });
    if (cause instanceof PersonalNoteChanged)
      throw new TRPCError({ code: "CONFLICT", message: cause.message });
    if (
      cause instanceof PersonalMemoryError &&
      cause.reason === "unauthenticated"
    )
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Sign in again to access your memory.",
      });
    if (result.error.code === "INTERNAL_SERVER_ERROR")
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Your personal memory is temporarily unavailable. Try again.",
        cause: result.error,
      });
  }
  return result;
});

export const personalMemoryRouter = {
  read: personalProcedure
    .output(personalMemorySnapshotSchema)
    .query(({ ctx, signal }) =>
      withSignal(signal, () => inspectPersonalMemory(ctx.requestHeaders))
    ),
  updateNote: personalProcedure
    .input(personalNoteUpdateSchema)
    .mutation(({ ctx, input, signal }) =>
      withSignal(signal, () => updatePersonalNote(ctx.requestHeaders, input))
    ),
};
