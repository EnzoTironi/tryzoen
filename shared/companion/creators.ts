import type { CreatorStudioData } from "@zoen/companion-ui";
import type { Client } from "eve/client";
import {
  creatorDraftListSchema,
  creatorDraftSchema,
  creatorPreviewSchema,
  creatorPreviewListSchema,
  creatorPreviewExportSchema,
  creatorPreviewReviewSchema,
  creatorReleaseCandidateSchema,
  creatorReleaseListSchema,
  creatorReleaseSchema,
  creatorPilotListSchema,
  creatorPilotSchema,
  creatorPilotTeachingSchema,
  creatorPilotFeedbackViewSchema,
} from "@zoen/companion-ui/creators";

export function companionCreatorData(
  rpc: {
    query: (path: string, input?: unknown) => Promise<unknown>;
    mutation: (path: string, input?: unknown) => Promise<unknown>;
  },
  newId: () => string,
  saveFile: (
    content: string,
    options: { filename: string; mediaType: string }
  ) => Promise<void>,
  sessions: Client["sessions"]
): CreatorStudioData {
  function exportJson(filename: string, content: Record<string, unknown>) {
    return saveFile(JSON.stringify(content, null, 2), {
      filename,
      mediaType: "application/json",
    });
  }
  return {
    newId,
    async pilotFeedback(id) {
      return creatorPilotFeedbackViewSchema.parse(
        await rpc.query("workspaces.creators.pilotFeedback", { id })
      );
    },
    async savePilotFeedback(input) {
      return creatorPilotFeedbackViewSchema.parse(
        await rpc.mutation("workspaces.creators.savePilotFeedback", input)
      );
    },
    async exportPilotFeedback(id) {
      const pilot = creatorPilotFeedbackViewSchema.parse(
        await rpc.query("workspaces.creators.pilotFeedback", { id })
      );
      await exportJson(`zoen-pilot-feedback-${id}.json`, {
        format: "zoen-creator-pilot-feedback",
        version: 1,
        pilot,
      });
    },
    async pilots() {
      return creatorPilotListSchema.parse(
        await rpc.query("workspaces.creators.pilots")
      );
    },
    async pilot(id) {
      return creatorPilotTeachingSchema.parse(
        await rpc.query("workspaces.creators.pilot", { id })
      );
    },
    async invitePilot(input) {
      return creatorPilotTeachingSchema.parse(
        await rpc.mutation("workspaces.creators.invitePilot", input)
      );
    },
    async actOnPilot(input) {
      return creatorPilotSchema.parse(
        await rpc.mutation("workspaces.creators.actOnPilot", input)
      );
    },
    async releaseCandidate(draftId) {
      return creatorReleaseCandidateSchema.parse(
        await rpc.query("workspaces.creators.releaseCandidate", { draftId })
      );
    },
    async approveRelease(input) {
      return creatorReleaseSchema.parse(
        await rpc.mutation("workspaces.creators.approveRelease", input)
      );
    },
    async releases(draftId) {
      return creatorReleaseListSchema.parse(
        await rpc.query("workspaces.creators.releases", { draftId })
      );
    },
    async release(id) {
      return creatorReleaseSchema.parse(
        await rpc.query("workspaces.creators.release", { id })
      );
    },
    async exportRelease(id) {
      const release = creatorReleaseSchema.parse(
        await rpc.query("workspaces.creators.release", { id })
      );
      await exportJson(`zoen-release-${id}.json`, {
        format: "zoen-creator-release",
        version: 1,
        release,
      });
    },
    async saveEvaluation(input) {
      return creatorDraftSchema.parse(
        await rpc.mutation("workspaces.creators.saveEvaluation", input)
      );
    },
    async reviewPreview(input) {
      return creatorPreviewReviewSchema.parse(
        await rpc.mutation("workspaces.creators.reviewPreview", input)
      );
    },
    async exportPreview(id) {
      const preview = creatorPreviewExportSchema.parse(
        await rpc.query("workspaces.creators.exportPreview", { id })
      );
      await exportJson(`zoen-preview-${id}.json`, {
        format: "zoen-creator-preview",
        version: 1,
        preview,
      });
    },
    async previews(draftId, pilotId) {
      return creatorPreviewListSchema.parse(
        await rpc.query("workspaces.creators.previews", { draftId, pilotId })
      );
    },
    async preview(input) {
      const preview = creatorPreviewSchema.parse(
        await rpc.mutation("workspaces.creators.preview", input)
      );
      if (preview.status !== "pending") return;
      // The coordinator receives only an opaque request ID. The workflow loads the
      // exact authorized snapshot; coordinator memory cannot enter the child prompt.
      await sessions.create({
        message: `Run the creator-preview tool with id ${preview.id}. The user created this private preview in Creator studio. Do not answer the test yourself or call other tools. The workflow saves the specialist's response in Creator studio.`,
      });
    },
    async archive(input) {
      return creatorDraftSchema.parse(
        await rpc.mutation("workspaces.creators.archive", input)
      );
    },
    async exportDraft(id) {
      const draft = creatorDraftSchema.parse(
        await rpc.query("workspaces.creators.read", { id })
      );
      await exportJson(`zoen-creator-${draft.id}.json`, {
        format: "zoen-creator-draft",
        version: 1,
        draft,
      });
    },
    async list() {
      return creatorDraftListSchema.parse(
        await rpc.query("workspaces.creators.list")
      );
    },
    async read(id) {
      return creatorDraftSchema.parse(
        await rpc.query("workspaces.creators.read", { id })
      );
    },
    async save(input) {
      return creatorDraftSchema.parse(
        await rpc.mutation("workspaces.creators.save", input)
      );
    },
  };
}
