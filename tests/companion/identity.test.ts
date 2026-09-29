import { expect, it, vi } from "vitest";
import { companionAgentData } from "@shared/companion/agent-data";
import { agentFiles } from "@shared/workspaces/agent-files";

it("shows missing documents as unsaved templates and keeps stored content intact", async () => {
  const rpc = {
    query: vi
      .fn<Parameters<typeof companionAgentData>[0]["query"]>()
      .mockResolvedValue({
        revision: "a".repeat(40),
        canEdit: true,
        documents: [
          {
            path: "agent/IDENTITY.md",
            content: "# Identity\n\nName: Reader\nWarm and calm.\n",
          },
          { path: "agent/MEMORY.md", content: "" },
        ],
      }),
    mutation: vi.fn<Parameters<typeof companionAgentData>[0]["mutation"]>(),
  };
  const data = companionAgentData(rpc, () => "operation", vi.fn());
  const identity = await data.identity();
  expect(rpc.query).toHaveBeenCalledWith("companion.identity");
  expect(identity.name).toBe("Reader");
  expect(identity.documents).toEqual([
    expect.objectContaining({ title: "Identity", saved: true }),
    {
      path: "agent/SOUL.md",
      title: "Soul",
      saved: false,
      text: agentFiles.find((file) => file.path === "agent/SOUL.md")?.content,
    },
    { path: "agent/MEMORY.md", title: "Memory", text: "", saved: true },
  ]);
});

it("preserves the revision and operation ID on save and propagates conflicts", async () => {
  const rpc = {
    query: vi.fn<Parameters<typeof companionAgentData>[0]["query"]>(),
    mutation: vi
      .fn<Parameters<typeof companionAgentData>[0]["mutation"]>()
      .mockRejectedValue(new Error("This file changed.")),
  };
  const data = companionAgentData(rpc, () => "same-operation", vi.fn());
  const draft = {
    path: "agent/SOUL.md",
    content: "Be clear.",
    expectedRevision: "a".repeat(40),
    operationId: data.newOperationId(),
  };
  await expect(data.saveIdentity(draft)).rejects.toThrow("This file changed.");
  expect(rpc.mutation).toHaveBeenCalledWith("workspaces.write", draft);
});
