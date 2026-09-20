import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { resolveCapabilities } from "../../server/tools/catalog";
import { readPublishedSkills } from "../../server/tools/skills";
import { workspaceFixture, workspaceExecutionFor } from "./workspace-fixture";
import {
  callNativeTool,
  nativeContext,
  readNativeSkill,
} from "../helpers/native-tools";
import { toolContextFor } from "../helpers/tool-context";
import { emptyOntology } from "../../shared/workspaces/ontology";
import {
  publishOntology,
  readOntology,
} from "../../server/workspaces/ontology";
import { ontologyActionInputSchema } from "../../server/tools/tools/ontology";
import workspaceSkills from "@agent/tools/workspace-skills";
import { WorkspaceAccessDenied } from "../../server/workspaces/access";

test("native tools and skills expose only the selected workspace", async () => {
  await using workspace = await workspaceFixture();
  const { actor, personal, guest, repository } = workspace;
  const saved = await repository.write(actor, {
    path: "skills/launch.md",
    content:
      "---\nrequires: [workspace_files_list]\n---\n# Launch checklist\n\nCheck the released revision.",
    expectedRevision: null,
    operationId: randomUUID(),
  });
  await repository.write(personal, {
    path: "skills/private.md",
    content: "# Private\nPRIVATE_SKILL_CANARY",
    expectedRevision: null,
    operationId: randomUUID(),
  });
  const context = workspaceExecutionFor(guest);
  const skills = await readPublishedSkills(guest);
  expect(skills.map((skill) => skill.path)).toEqual(["skills/launch.md"]);
  expect(JSON.stringify(skills)).not.toContain("PRIVATE_SKILL_CANARY");
  const loaded = await readNativeSkill(context, "skills/launch.md");
  expect(loaded).toHaveProperty(
    "instructions",
    expect.stringContaining("Check the released revision")
  );
  expect(loaded).toMatchObject({
    execution: "instructions",
    revision: saved.revision,
  });
  expect(
    await callNativeTool(context, "workspace_files_list", {})
  ).toMatchObject({ revision: saved.revision });
  await expect(readNativeSkill(context, "agent/SOUL.md")).rejects.toThrow(
    Error
  );
  await expect(
    callNativeTool(context, "workspace_files_list", {
      workspaceId: personal.workspaceId,
    })
  ).rejects.toThrow(Error);
  const catalog = await resolveCapabilities(nativeContext(context));
  expect(catalog["workspace-save"]?.inputSchema).toBeDefined();
  expect(
    Object.keys(catalog).every((name) => /^[a-zA-Z0-9_-]{1,64}$/.test(name))
  ).toBe(true);
});

test("cached procedure tools reread files capability and current workspace membership", async () => {
  await using workspace = await workspaceFixture();
  const { actor, guest, repository } = workspace;
  const saved = await repository.write(actor, {
    path: "skills/cached.md",
    content: "# Cached procedure\nRead the shared notes.",
    expectedRevision: null,
    operationId: randomUUID(),
  });
  const execution = workspaceExecutionFor(guest);
  const tools = await workspaceSkills.events["turn.started"]?.(
    {},
    nativeContext(execution)
  );
  if (!tools) throw new Error("Expected scoped procedure tools.");
  expect(
    await tools.workspace_skills_load.execute(
      { path: "skills/cached.md" },
      execution
    )
  ).toMatchObject({ execution: "instructions", revision: saved.revision });

  await repository.write(actor, {
    path: "plugins/workspace.json",
    content: '{"version":1,"enabled":[]}',
    expectedRevision: saved.revision,
    operationId: randomUUID(),
  });
  expect(await tools.workspace_skills_list.execute({}, execution)).toEqual([]);
  await expect(
    tools.workspace_skills_load.execute({ path: "skills/cached.md" }, execution)
  ).rejects.toThrow("Published procedure unavailable");

  await query(sql`DELETE FROM workspace_memberships
    WHERE user_id = ${guest.userId} AND workspace_id = ${guest.workspaceId}`);
  await expect(
    tools.workspace_skills_list.execute({}, execution)
  ).rejects.toThrow(WorkspaceAccessDenied);
  await expect(
    tools.workspace_skills_load.execute({ path: "skills/cached.md" }, execution)
  ).rejects.toThrow(WorkspaceAccessDenied);
});

test("native writes retain the durable call ID on replay and reject forbidden paths", async () => {
  await using workspace = await workspaceFixture();
  const { actor, repository } = workspace;
  const context = workspaceExecutionFor(actor);
  const input = {
    path: "knowledge/eval.md",
    expectedRevision: null,
    content: "EVAL_PERSISTED_ONCE",
  };
  const first = await callNativeTool(context, "workspace-save", input);
  expect(await callNativeTool(context, "workspace-save", input)).toEqual(first);
  expect((await repository.read(actor, input.path)).content).toBe(
    input.content
  );
  expect(await repository.history(actor, input.path)).toHaveLength(1);
  await expect(
    callNativeTool(context, "workspace-save", {
      ...input,
      path: "agent/SOUL.md",
    })
  ).rejects.toThrow(Error);
});

test("a workspace project exposes its local approved action by default and respects plugin removal", async () => {
  await using workspace = await workspaceFixture();
  const { actor, guest, repository } = workspace;
  const saved = await publishOntology(actor, {
    expectedRevision: null,
    operationId: randomUUID(),
    graph: {
      ...emptyOntology,
      entities: [
        {
          id: "audit_project",
          type: "project",
          name: "Functional audit project",
          properties: { status: "planned" },
          sources: [],
        },
      ],
    },
  });
  const context = workspaceExecutionFor(actor);
  const catalog = await resolveCapabilities(nativeContext(context));
  const action = catalog["ontology-action"];
  expect(action?.approval).toBeDefined();
  const inventory = await callNativeTool(
    context,
    "workspace_ontology_read",
    {}
  );
  expect(inventory).toMatchObject({
    revision: saved.revision,
    graph: {
      entities: [{ id: "audit_project", properties: { status: "planned" } }],
    },
  });
  const input = {
    entityId: "audit_project",
    actionId: "project_status",
    value: "active",
    expectedRevision: saved.revision,
    approvalMessage: "Change Functional audit project from planned to active?",
  };
  await expect(
    callNativeTool(workspaceExecutionFor(guest), "ontology-action", input)
  ).rejects.toMatchObject({ name: "WorkspaceAccessDenied" });
  const changed = await callNativeTool(context, "ontology-action", input);
  expect(changed).toMatchObject({
    status: "completed",
    entityId: input.entityId,
    actionId: input.actionId,
    value: input.value,
  });
  expect(await callNativeTool(context, "ontology-action", input)).toEqual(
    changed
  );
  const current = await readOntology(actor);
  expect(changed).toMatchObject({ revision: current.revision });
  expect(current.graph.entities[0]?.properties.status).toBe("active");
  expect(
    await repository.history(actor, "ontology/workspace.json")
  ).toHaveLength(2);

  await repository.write(actor, {
    path: "plugins/workspace.json",
    content: '{"version":1,"enabled":["files","memory"]}',
    expectedRevision: current.revision,
    operationId: randomUUID(),
  });
  const disabled = await resolveCapabilities(nativeContext(context));
  expect(disabled["ontology-action"]).toBeUndefined();
  expect(disabled.workspace_ontology_read).toBeUndefined();
  const retainedInput = ontologyActionInputSchema.parse({
    ...input,
    expectedRevision: current.revision,
  });
  await expect(
    // SAFETY: the owner schema above validated this retained tool's exact input.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The schema or pinned SDK contract establishes this boundary.
    action?.execute(retainedInput as never, context)
  ).rejects.toMatchObject({ name: "WorkspaceAccessDenied" });
  expect((await readOntology(actor)).graph.entities[0]?.properties.status).toBe(
    "active"
  );
});

test("scheduled result turns expose only their reporting capabilities", async () => {
  const base = toolContextFor();
  const principal = {
    principalId: "synthetic-report",
    principalType: "system",
    authenticator: "scheduled-result",
    attributes: {},
  };
  const context = {
    ...base,
    session: {
      ...base.session,
      auth: { current: principal, initiator: principal },
    },
  };
  const catalog = await resolveCapabilities(nativeContext(context));
  expect(catalog["schedules-answer"]).toBeDefined();
  expect(
    Object.keys(catalog).some((name) => name.startsWith("workspace"))
  ).toBe(false);
  await expect(
    callNativeTool(context, "workspace_files_list", {})
  ).rejects.toThrow(Error);
});

test("discovery and retained tools recheck plugin changes and membership removal", async () => {
  await using workspace = await workspaceFixture();
  const { actor, guest, repository } = workspace;
  const context = workspaceExecutionFor(guest);
  const first = await repository.write(actor, {
    path: "plugins/workspace.json",
    content: '{"version":1,"enabled":["files","google"]}',
    expectedRevision: null,
    operationId: randomUUID(),
  });
  const available = await resolveCapabilities(nativeContext(context));
  expect(available["gmail-search"]).toBeDefined();
  const retained = available.workspace_files_list;
  expect(retained).toBeDefined();
  await repository.write(actor, {
    path: "plugins/workspace.json",
    content: '{"version":1,"enabled":["files"]}',
    expectedRevision: first.revision,
    operationId: randomUUID(),
  });
  expect(
    (await resolveCapabilities(nativeContext(context)))["gmail-search"]
  ).toBeUndefined();
  await expect(
    callNativeTool(context, "gmail-search", { query: "anything" })
  ).rejects.toThrow(Error);
  await query(
    sql`DELETE FROM organization_memberships WHERE user_id = ${guest.userId}`
  );
  await expect(resolveCapabilities(nativeContext(context))).rejects.toThrow(
    Error
  );
  // SAFETY: this is the empty input declared by the retained list tool.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The schema or pinned SDK contract establishes this boundary.
  await expect(retained?.execute({} as never, context)).rejects.toThrow(Error);
});
