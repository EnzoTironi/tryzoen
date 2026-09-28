import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  creatorEvaluationSaveSchema,
  creatorDraftListSchema,
  creatorDraftSaveSchema,
  creatorDraftSchema,
  creatorDraftStateSchema,
  creatorPreviewRequestSchema,
  creatorPreviewSchema,
  creatorPreviewListSchema,
  creatorPreviewExportSchema,
  creatorPreviewReviewSaveSchema,
  creatorPreviewReviewSchema,
} from "@zoen/companion-ui/creators";
import {
  CreatorReviewConflict,
  saveCreatorPreviewReview,
} from "../../server/creators/reviews";
import {
  CreatorDraftConflict,
  listCreatorDrafts,
  readCreatorDraft,
  saveCreatorDraft,
  setCreatorDraftArchived,
} from "../../server/creators/drafts";
import { saveCreatorEvaluation } from "../../server/creators/evaluation";
import { withSignal } from "../../server/operations/async";
import { workspaceProcedure } from "./workspace-procedure";
import {
  createCreatorPreview,
  listCreatorPreviews,
  exportCreatorPreview,
} from "../../server/creators/previews";

export const creatorsRouter = {
  saveEvaluation: workspaceProcedure
    .input(creatorEvaluationSaveSchema)
    .output(creatorDraftSchema)
    .mutation(({ ctx, input, signal }) =>
      withSignal(signal, async () => {
        try {
          return await saveCreatorEvaluation(ctx.actor, input);
        } catch (error) {
          if (error instanceof CreatorDraftConflict)
            throw new TRPCError({ code: "CONFLICT", message: error.message });
          throw error;
        }
      })
    ),
  reviewPreview: workspaceProcedure
    .input(creatorPreviewReviewSaveSchema)
    .output(creatorPreviewReviewSchema)
    .mutation(({ ctx, input, signal }) =>
      withSignal(signal, async () => {
        try {
          return await saveCreatorPreviewReview(ctx.actor, input);
        } catch (error) {
          if (error instanceof CreatorReviewConflict)
            throw new TRPCError({ code: "CONFLICT", message: error.message });
          throw error;
        }
      })
    ),
  exportPreview: workspaceProcedure
    .input(z.strictObject({ id: z.uuid() }))
    .output(creatorPreviewExportSchema)
    .query(({ ctx, input, signal }) =>
      withSignal(signal, () => exportCreatorPreview(ctx.actor, input.id))
    ),
  preview: workspaceProcedure
    .input(creatorPreviewRequestSchema)
    .output(creatorPreviewSchema)
    .mutation(({ ctx, input, signal }) =>
      withSignal(signal, () => createCreatorPreview(ctx.actor, input))
    ),
  previews: workspaceProcedure
    .input(z.strictObject({ draftId: z.uuid() }))
    .output(creatorPreviewListSchema)
    .query(({ ctx, input, signal }) =>
      withSignal(signal, () => listCreatorPreviews(ctx.actor, input.draftId))
    ),
  archive: workspaceProcedure
    .input(creatorDraftStateSchema)
    .output(creatorDraftSchema)
    .mutation(({ ctx, input, signal }) =>
      withSignal(signal, async () => {
        try {
          return await setCreatorDraftArchived(ctx.actor, input);
        } catch (error) {
          if (error instanceof CreatorDraftConflict)
            throw new TRPCError({ code: "CONFLICT", message: error.message });
          throw error;
        }
      })
    ),
  list: workspaceProcedure
    .output(creatorDraftListSchema)
    .query(({ ctx, signal }) =>
      withSignal(signal, () => listCreatorDrafts(ctx.actor))
    ),
  read: workspaceProcedure
    .input(z.object({ id: z.uuid() }).strict())
    .output(creatorDraftSchema)
    .query(({ ctx, input, signal }) =>
      withSignal(signal, () => readCreatorDraft(ctx.actor, input.id))
    ),
  save: workspaceProcedure
    .input(creatorDraftSaveSchema)
    .output(creatorDraftSchema)
    .mutation(({ ctx, input, signal }) =>
      withSignal(signal, async () => {
        try {
          return await saveCreatorDraft(ctx.actor, input);
        } catch (error) {
          if (error instanceof CreatorDraftConflict)
            throw new TRPCError({ code: "CONFLICT", message: error.message });
          throw error;
        }
      })
    ),
};
