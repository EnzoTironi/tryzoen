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
  creatorReleaseCandidateSchema,
  creatorReleaseListSchema,
  creatorReleaseRequestSchema,
  creatorReleaseSchema,
  creatorPilotInviteSchema,
  creatorPilotActionSchema,
  creatorPilotSchema,
  creatorPilotListSchema,
  creatorPilotTeachingSchema,
} from "@zoen/companion-ui/creators";
import {
  actOnCreatorPilot,
  inviteCreatorPilot,
  listCreatorPilots,
  readCreatorPilot,
} from "../../server/creators/pilots";
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
import { readCreatorReleaseCandidate } from "../../server/creators/release-candidate";
import {
  approveCreatorRelease,
  listCreatorReleases,
  readCreatorRelease,
} from "../../server/creators/releases";
import { withSignal } from "../../server/operations/async";
import { workspaceProcedure } from "./workspace-procedure";
import {
  createCreatorPreview,
  listCreatorPreviews,
  exportCreatorPreview,
} from "../../server/creators/previews";

export const creatorsRouter = {
  pilots: workspaceProcedure
    .output(creatorPilotListSchema)
    .query(({ ctx, signal }) =>
      withSignal(signal, () => listCreatorPilots(ctx.actor))
    ),
  pilot: workspaceProcedure
    .input(z.strictObject({ id: z.uuid() }))
    .output(creatorPilotTeachingSchema)
    .query(({ ctx, input, signal }) =>
      withSignal(signal, () => readCreatorPilot(ctx.actor, input.id))
    ),
  invitePilot: workspaceProcedure
    .input(creatorPilotInviteSchema)
    .output(creatorPilotTeachingSchema)
    .mutation(({ ctx, input, signal }) =>
      withSignal(signal, () => inviteCreatorPilot(ctx.actor, input))
    ),
  actOnPilot: workspaceProcedure
    .input(creatorPilotActionSchema)
    .output(creatorPilotSchema)
    .mutation(({ ctx, input, signal }) =>
      withSignal(signal, () => actOnCreatorPilot(ctx.actor, input))
    ),
  releaseCandidate: workspaceProcedure
    .input(z.strictObject({ draftId: z.uuid() }))
    .output(creatorReleaseCandidateSchema)
    .query(({ ctx, input, signal }) =>
      withSignal(signal, () =>
        readCreatorReleaseCandidate(ctx.actor, input.draftId)
      )
    ),
  approveRelease: workspaceProcedure
    .input(creatorReleaseRequestSchema)
    .output(creatorReleaseSchema)
    .mutation(({ ctx, input, signal }) =>
      withSignal(signal, () => approveCreatorRelease(ctx.actor, input))
    ),
  releases: workspaceProcedure
    .input(z.strictObject({ draftId: z.uuid() }))
    .output(creatorReleaseListSchema)
    .query(({ ctx, input, signal }) =>
      withSignal(signal, () => listCreatorReleases(ctx.actor, input.draftId))
    ),
  release: workspaceProcedure
    .input(z.strictObject({ id: z.uuid() }))
    .output(creatorReleaseSchema)
    .query(({ ctx, input, signal }) =>
      withSignal(signal, () => readCreatorRelease(ctx.actor, input.id))
    ),
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
    .input(z.strictObject({ draftId: z.uuid(), pilotId: z.uuid().optional() }))
    .output(creatorPreviewListSchema)
    .query(({ ctx, input, signal }) =>
      withSignal(signal, () =>
        listCreatorPreviews(ctx.actor, input.draftId, input.pilotId)
      )
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
