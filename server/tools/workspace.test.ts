import { beforeEach, expect, it, vi } from "vitest";
import { invokeWorkspaceTool, readWorkspaceToolCatalog } from "./workspace";

const configuration = vi.hoisted(() => ({ url: false, key: false }));

vi.mock("@shared/environment/env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@shared/environment/env")>()),
  env: {
    ...(await importOriginal<typeof import("@shared/environment/env")>()).env,
    get ZOEN_SESSION_ARCHIVE_DIR() {
      return configuration.url ? "/synthetic/archive" : undefined;
    },
    get ZOEN_AI_MEMORY_BINARY() {
      return configuration.key ? "/synthetic/ai-memory" : undefined;
    },
  },
}));
vi.mock("../workspaces/capabilities", () => ({
  readWorkspaceCapabilities: async () => ({
    revision: "a".repeat(40),
    enabled: ["files", "memory", "ontology"],
  }),
}));

const actor = { userId: "member", workspaceId: "workspace" };

beforeEach(() => {
  configuration.url = false;
  configuration.key = false;
});

it.each([
  { url: false, key: false },
  { url: true, key: false },
  { url: false, key: true },
])("omits unavailable learned-memory tools (%j)", async (config) => {
  Object.assign(configuration, config);
  const catalog = await readWorkspaceToolCatalog(actor);
  const names = catalog.tools.map((tool) => tool.path);
  expect(names).not.toContain("workspace_memory_search");
  expect(names).toContain("workspace_files_read");
  expect(names).toContain("workspace_ontology_read");
  await expect(
    invokeWorkspaceTool(actor, {
      path: "workspace_memory_search",
      args: { query: "my tea preference" },
    })
  ).rejects.toThrow("ToolAccessDenied");
});

it("exposes learned-memory search only when configured and private", async () => {
  configuration.url = true;
  configuration.key = true;
  expect(
    (await readWorkspaceToolCatalog(actor)).tools.map((tool) => tool.path)
  ).toContain("workspace_memory_search");
  expect(
    (
      await readWorkspaceToolCatalog({ ...actor, groupBindingId: "group" })
    ).tools.map((tool) => tool.path)
  ).not.toContain("workspace_memory_search");
});
