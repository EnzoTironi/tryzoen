import { randomUUID } from "node:crypto";
import { expect, test, vi } from "vitest";
import { toolContextFor } from "../../helpers/tool-context";
import library from "../../../agent/tools/creator-library";
import { createCreatorPreview } from "../../../server/creators/previews";
import { workspaceOperationId } from "../../../agent/lib/workspace-operation";
vi.mock("../../../server/creators/previews", () => ({
  createCreatorPreview:
    vi.fn<
      typeof import("../../../server/creators/previews").createCreatorPreview
    >(),
  exportCreatorPreview:
    vi.fn<
      typeof import("../../../server/creators/previews").exportCreatorPreview
    >(),
}));
vi.mock("../../../server/workspaces/access", () => ({
  workspaceActorFromPrincipal: vi
    .fn<
      typeof import("../../../server/workspaces/access").workspaceActorFromPrincipal
    >()
    .mockResolvedValue({
      userId: "owner",
      workspaceId: "personal",
      role: "owner",
      organizationId: null,
    }),
}));
vi.mock("../../../server/creators/drafts", () => ({
  requireCreator:
    vi.fn<typeof import("../../../server/creators/drafts").requireCreator>(),
  listCreatorDrafts:
    vi.fn<typeof import("../../../server/creators/drafts").listCreatorDrafts>(),
  readCreatorDraft:
    vi.fn<typeof import("../../../server/creators/drafts").readCreatorDraft>(),
  saveCreatorDraft:
    vi.fn<typeof import("../../../server/creators/drafts").saveCreatorDraft>(),
}));
test("preview request identity is stable for native replay and distinct across turns or calls", async () => {
  const preview = {
    draftId: randomUUID(),
    revision: randomUUID(),
    question: "Question",
    kind: "answer" as const,
  };
  const context = toolContextFor({
    sessionId: "session",
    callId: "call",
    toolName: "creator-library",
  });
  await library.execute({ action: "preview", preview }, context);
  await library.execute({ action: "preview", preview }, context);
  await library.execute(
    { action: "preview", preview },
    {
      ...context,
      session: { ...context.session, turn: { id: "next-turn", sequence: 1 } },
    }
  );
  await library.execute(
    { action: "preview", preview },
    { ...context, callId: "next-call" }
  );
  const ids = vi
    .mocked(createCreatorPreview)
    .mock.calls.map(([, input]) => input.id);
  expect(ids[0]).toBe(
    workspaceOperationId(
      "session",
      JSON.stringify(["test-turn", "creator-library", "call", "preview"])
    )
  );
  expect(ids[1]).toBe(ids[0]);
  expect(new Set(ids).size).toBe(3);
});
