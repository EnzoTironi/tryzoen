import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { expect, test } from "vitest";
import {
  callNativeTool,
  nativeContext,
  readNativeSkill,
} from "../helpers/native-tools";

import { resolveCustomerTools } from "../../server/tools/customer-tools";

import { WorkspaceAccessDenied } from "../../server/workspaces/access";
import { publishSkillProposal } from "../../server/workspaces/skills";
import { customerToolId } from "../../server/workspaces/tool-document";
import {
  disableCustomerTool,
  publishCustomerTool,
  rollbackCustomerTool,
  validateCustomerTool,
} from "../../server/workspaces/tools";

import { workspaceFixture, workspaceExecutionFor } from "./workspace-fixture";
import { linkedIdentity } from "./identity-fixture";

const objectSchema = {
  type: "object",
  properties: { text: { type: "string", maxLength: 100 } },
  required: ["text"],
  additionalProperties: false,
};
const manifest = (code = "return { text: input.text.trim() };") =>
  JSON.stringify({
    name: "Organize my inbox",
    description: "Normalize an email subject.",
    inputSchema: objectSchema,
    outputSchema: objectSchema,
    implementation: { kind: "code", code, requires: [] },
    tests: [
      { input: { text: " Hello " }, expected: { text: "Hello" }, fixtures: {} },
    ],
  });

test("TL: publish, discover, compose and revoke a versioned personal tool and its skill", async () => {
  await using workspace = await workspaceFixture();
  const { personal, guestPersonal, repository } = workspace;
  const content = manifest();
  const id = customerToolId("inbox", content);
  const drafted = await repository.write(personal, {
    operationId: randomUUID(),
    expectedRevision: null,
    path: "proposals/tools/inbox.json",
    content,
  });
  const input = {
    slug: "inbox",
    operationId: randomUUID(),
    expectedRevision: drafted.revision,
  };
  expect(await validateCustomerTool(personal, content)).toMatchObject({
    status: "passed",
    tests: 1,
  });
  const published = await publishCustomerTool(personal, input);
  expect(await publishCustomerTool(personal, input)).toEqual(published);
  const skill = await repository.write(personal, {
    operationId: randomUUID(),
    expectedRevision: published.revision,
    path: "proposals/skills/inbox.md",
    content: `---\nrequires: [${id}]\n---\n# Organize my inbox\n\nUse the pinned subject normalization tool.\n`,
  });
  const skillPublished = await publishSkillProposal(personal, {
    operationId: randomUUID(),
    expectedRevision: skill.revision,
    proposal: "proposals/skills/inbox.md",
  });
  const execution = workspaceExecutionFor(personal);

  const results = await Promise.all(
    Array.from({ length: 4 }, () =>
      callNativeTool(execution, id, { text: " Done " })
    )
  );
  expect(
    results.every(
      (result) => JSON.stringify(result) === JSON.stringify({ text: "Done" })
    )
  ).toBe(true);
  expect(
    JSON.stringify(await readNativeSkill(execution, "skills/inbox.md"))
  ).toContain('"execution":"instructions"');
  expect(
    await resolveCustomerTools(
      nativeContext(workspaceExecutionFor(guestPersonal))
    )
  ).toEqual({});
  const cached = (await resolveCustomerTools(nativeContext(execution)))[id];
  if (!cached) throw new Error("Missing published tool");
  const disabled = await disableCustomerTool(personal, {
    slug: "inbox",
    expectedRevision: skillPublished.revision,
    operationId: randomUUID(),
  });
  const cachedCall = await Promise.try(async () => {
    // SAFETY: this input matches objectSchema; exercise the retained descriptor after revoke.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The schema or pinned SDK contract establishes this boundary.
    return await cached.execute({ text: "Denied" } as never, execution);
  }).then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error })
  );
  expect(!cachedCall.ok).toBe(true);
  expect(
    !(
      await Promise.try(async () =>
        callNativeTool(execution, id, { text: "Denied" })
      ).then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error })
      )
    ).ok
  ).toBe(true);
  expect(
    JSON.stringify(await readNativeSkill(execution, "skills/inbox.md"))
  ).toContain('"execution":"blocked"');
  const restored = await rollbackCustomerTool(personal, {
    slug: "inbox",
    operationId: randomUUID(),
    expectedRevision: disabled.revision,
    revision: published.revision,
  });
  expect(restored.revision).not.toBe(published.revision);
  expect(await callNativeTool(execution, id, { text: " Done " })).toEqual({
    text: "Done",
  });
});

test("TL: team member proposes but cannot bypass validated publication", async () => {
  await using workspace = await workspaceFixture();
  const { actor, guest, repository } = workspace;
  const draft = await repository.write(guest, {
    operationId: randomUUID(),
    expectedRevision: null,
    path: "proposals/tools/meeting.json",
    content: manifest(),
  });
  const denied = await Promise.try(async () =>
    publishCustomerTool(guest, {
      slug: "meeting",
      operationId: randomUUID(),
      expectedRevision: draft.revision,
    })
  ).then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error })
  );
  expect(!denied.ok && denied.error).toBeInstanceOf(WorkspaceAccessDenied);
  const bypass = await Promise.try(async () =>
    repository.write(actor, {
      operationId: randomUUID(),
      expectedRevision: draft.revision,
      path: "tools/meeting.json",
      content: manifest(),
    })
  ).then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error })
  );
  expect(!bypass.ok && bypass.error).toBeInstanceOf(WorkspaceAccessDenied);
  await publishCustomerTool(actor, {
    slug: "meeting",
    operationId: randomUUID(),
    expectedRevision: draft.revision,
  });
  expect(
    JSON.stringify(
      await callNativeTool(
        workspaceExecutionFor(guest),
        customerToolId("meeting", manifest()),
        { text: " Ready " }
      )
    )
  ).toContain('"text":"Ready"');
});

test.each([
  "return {text: process.env.SECRET};",
  "return {text: require('node:fs').readFileSync('/etc/passwd')};",
  "while(true) {}",
  "return {text: 'wrong'};",
  "return await tools.workspace_files_list({});",
])(
  "TL: invalid or malicious customer code cannot be published: %s",
  async (code) => {
    await using workspace = await workspaceFixture();
    const { personal } = workspace;
    expect(
      !(
        await Promise.try(async () =>
          validateCustomerTool(personal, manifest(code))
        ).then(
          (value) => ({ ok: true as const, value }),
          (error: unknown) => ({ ok: false as const, error })
        )
      ).ok
    ).toBe(true);
  }
);

test("TL: a bound group can propose and use a published tool, and removal revokes it", async () => {
  await using workspace = await workspaceFixture();
  const { actor, guest, repository } = workspace;
  const installationId = `tools-${randomUUID()}`;
  const identity = await linkedIdentity(
    { channel: "telegram", installationId, senderId: "member" },
    { userId: guest.userId.slice("better-auth:".length) }
  );
  const binding = randomUUID();
  await query(sql`INSERT INTO workspace_group_bindings (id, workspace_id, channel, installation_id, conversation_id, label, created_by)
    VALUES (${binding}, ${actor.workspaceId}, 'telegram', ${installationId}, ${randomUUID()}, 'Synthetic tool group', ${actor.userId})`);
  const group = {
    userId: guest.userId,
    workspaceId: guest.workspaceId,
    channelIdentityId: identity.id,
    groupBindingId: binding,
  };
  const draft = await repository.write(group, {
    operationId: randomUUID(),
    expectedRevision: null,
    path: "proposals/tools/summary.json",
    content: manifest(),
  });
  expect(
    !(
      await Promise.try(async () =>
        publishCustomerTool(group, {
          slug: "summary",
          operationId: randomUUID(),
          expectedRevision: draft.revision,
        })
      ).then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error })
      )
    ).ok
  ).toBe(true);
  await publishCustomerTool(actor, {
    slug: "summary",
    operationId: randomUUID(),
    expectedRevision: draft.revision,
  });
  const base = workspaceExecutionFor(guest);
  const principal = {
    principalId: guest.userId,
    principalType: "user",
    authenticator: "verified-channel",
    attributes: {
      chatKind: "group",
      workspaceId: guest.workspaceId,
      channelIdentityId: identity.id,
      groupBindingId: binding,
    },
  };
  const execution = {
    ...base,
    session: {
      ...base.session,
      auth: { current: principal, initiator: principal },
    },
  };
  const id = customerToolId("summary", manifest());
  expect(
    JSON.stringify(await callNativeTool(execution, id, { text: " Shared " }))
  ).toContain('"text":"Shared"');
  await query(
    sql`DELETE FROM workspace_memberships WHERE workspace_id = ${actor.workspaceId} AND user_id = ${guest.userId}`
  );
  expect(
    !(
      await Promise.try(async () =>
        callNativeTool(execution, id, { text: "Forbidden" })
      ).then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error })
      )
    ).ok
  ).toBe(true);
});
