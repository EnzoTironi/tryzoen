import type { CreatorStudioData } from "@zoen/companion-ui";
import type { Client } from "eve/client";
import {
  creatorDraftListSchema,
  creatorDraftSchema,
  creatorPreviewSchema,
  creatorPreviewListSchema,
  creatorPreviewExportSchema,
  creatorPreviewReviewSchema,
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
  return {
    newId,
    async reviewPreview(input) {
      return creatorPreviewReviewSchema.parse(
        await rpc.mutation("workspaces.creators.reviewPreview", input)
      );
    },
    async exportPreview(id) {
      const preview = creatorPreviewExportSchema.parse(
        await rpc.query("workspaces.creators.exportPreview", { id })
      );
      await saveFile(
        JSON.stringify(
          { format: "zoen-creator-preview", version: 1, preview },
          null,
          2
        ),
        { filename: `zoen-preview-${id}.json`, mediaType: "application/json" }
      );
    },
    async previews(draftId) {
      return creatorPreviewListSchema.parse(
        await rpc.query("workspaces.creators.previews", { draftId })
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
      await saveFile(
        JSON.stringify(
          { format: "zoen-creator-draft", version: 1, draft },
          null,
          2
        ),
        {
          filename: `zoen-creator-${draft.id}.json`,
          mediaType: "application/json",
        }
      );
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
