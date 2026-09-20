import { mapAsync } from "../operations/async";
import { isValid } from "@shared/validation";
import { z } from "zod";
import { isDeepStrictEqual } from "node:util";

import {
  requireWorkspaceAccess,
  WorkspaceAccessDenied,
  type WorkspaceActorSchema,
} from "./access";
import { WorkspaceRepository, WorkspaceWriteSchema } from "./repository";
import { GitRevisionSchema } from "./git";
import {
  CustomerToolError,
  customerToolId,
  decodeCustomerTool,
  decodeCustomerValue,
  ToolProposalPath,
  PublishedToolPath,
  ToolSlug,
} from "./tool-document";
import { executeCustomerCode } from "../tools/customer-runtime";
import { readWorkspaceToolCatalog } from "../tools/workspace";
import { requireRemoteTool } from "../connectors/connections";

export const CustomerToolPublication = z.object({
  slug: ToolSlug,
  operationId: WorkspaceWriteSchema.shape.operationId,
  expectedRevision: WorkspaceWriteSchema.shape.expectedRevision,
});
export const CustomerToolRollback = z.object({
  ...CustomerToolPublication.shape,
  revision: GitRevisionSchema,
});

export const listCustomerTools = async function (
  actor: z.output<typeof WorkspaceActorSchema>
) {
  const repository = WorkspaceRepository;
  const listing = await repository.read(actor);
  const selection = await repository.selection(
    actor,
    listing.files.filter(
      (path) =>
        isValid(PublishedToolPath, path) ||
        (!actor.agentGrantId &&
          !actor.groupBindingId &&
          isValid(ToolProposalPath, path))
    )
  );
  const tools = await mapAsync(
    selection.documents,
    async (document) => {
      const definition = await decodeCustomerTool(document.content);
      const slug =
        document.path
          .split("/")
          .at(-1)
          ?.replace(/\.json$/u, "") ?? "";
      return {
        path: document.path,
        slug,
        name: definition.name,
        description: definition.description,
        id: customerToolId(slug, document.content),
        revision: selection.revision,
        draft: document.path.startsWith("proposals/"),
      };
    },
    1
  );
  return { revision: selection.revision, tools };
};

export const validateCustomerTool = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  content: string
) {
  await requireWorkspaceAccess(actor);
  if (actor.agentGrantId) throw new WorkspaceAccessDenied();
  const tool = await decodeCustomerTool(content);
  if (tool.implementation.kind !== "code") {
    await requireRemoteTool(actor, tool);
    await mapAsync(
      tool.tests,
      async (test) => {
        await decodeCustomerValue(tool.inputSchema, test.input);
        await decodeCustomerValue(tool.outputSchema, test.expected, true);
      },
      1
    );
    return { name: tool.name, tests: 0, status: "validated" as const };
  }
  const available = new Set<string>(
    (await readWorkspaceToolCatalog(actor)).tools.map((entry) => entry.path)
  );
  // Customer code composes this workspace's bounded reads. Native actions and
  // other customer tools cannot be hidden inside it, even with an approval.
  if (
    tool.implementation.requires.some(
      (path) => !available.has(path) || path.startsWith("workspace_google_")
    )
  )
    throw new CustomerToolError({ reason: "dependency_unavailable" });
  await mapAsync(
    tool.tests,
    async (test) => {
      const result = await executeCustomerCode(tool, test.input, {
        invoke: (call) => {
          const fixture = test.fixtures[call.path];
          return fixture === undefined
            ? Promise.reject(new CustomerToolError({ reason: "test_failed" }))
            : Promise.resolve(fixture);
        },
      });
      if (!isDeepStrictEqual(result, test.expected))
        throw new CustomerToolError({ reason: "test_failed" });
      return undefined;
    },
    1
  );
  return {
    name: tool.name,
    tests: tool.tests.length,
    status: "passed" as const,
  };
};

export const publishCustomerTool = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  input: z.output<typeof CustomerToolPublication>
) {
  await requireWorkspaceAccess(actor, true);
  const repository = WorkspaceRepository;
  const proposal = `proposals/tools/${input.slug}.json`;
  const file = await repository.read(
    actor,
    proposal,
    input.expectedRevision ?? undefined
  );
  if (!file.content) throw new CustomerToolError({ reason: "unavailable" });
  await validateCustomerTool(actor, file.content);
  return await repository.write(
    actor,
    { ...input, path: `tools/${input.slug}.json`, content: file.content },
    { kind: "tool-publication", proposal }
  );
};

export const rollbackCustomerTool = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  input: z.output<typeof CustomerToolRollback>
) {
  await requireWorkspaceAccess(actor, true);
  const repository = WorkspaceRepository;
  const path = `tools/${input.slug}.json`;
  const file = await repository.read(actor, path, input.revision);
  if (!file.content) throw new CustomerToolError({ reason: "unavailable" });
  await validateCustomerTool(actor, file.content);
  return await repository.write(
    actor,
    { ...input, path, content: file.content },
    { kind: "tool-rollback", revision: input.revision }
  );
};

export const disableCustomerTool = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  input: z.output<typeof CustomerToolPublication>
) {
  await requireWorkspaceAccess(actor, true);
  return await WorkspaceRepository.write(
    actor,
    { ...input, path: `tools/${input.slug}.json`, content: null },
    { kind: "tool-disable" }
  );
};
