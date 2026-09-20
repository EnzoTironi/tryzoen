import { onTestFinished } from "vitest";
import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { saveDirectoryProfile } from "../../server/accounts/directory";
import {
  A2AError,
  A2AMessageSchema,
  cancelProtocolTask,
  finishProtocolTask,
  readProtocolTask,
} from "../../server/a2a/tasks";
import { readWorkspaceToolCatalog } from "../../server/tools/workspace";
import {
  saveWorkspaceBot,
  searchWorkspaceBots,
} from "../../server/workspaces/bots";
import {
  ContactNetworkBotSchema,
  answerPersonalTrust,
  blockPersonalTrust,
  contactNetworkBot,
  endPersonalTrust,
  invitePersonalTrust,
  listPersonalNetwork,
} from "../../server/workspaces/network";
import {
  inviteWorkspaceMember,
  removeWorkspaceMember,
} from "../../server/workspaces/team";
import { accessScopeForUser } from "../../shared/identity/access-scope";
import { workspaceFixture } from "./workspace-fixture";
const handle = (prefix: string) =>
  `${prefix}${randomUUID().replaceAll("-", "").slice(0, 16)}`;
const profile = (name: string) => ({
  username: handle("b"),
  name,
  description: "Synthetic network bot",
  discoverable: true,
});
const prompt = (text: string) => ({
  messageId: randomUUID(),
  role: "ROLE_USER" as const,
  parts: [
    {
      text,
    },
  ],
});
const denied = (
  result:
    | {
        ok: true;
        value: unknown;
      }
    | {
        ok: false;
        error: unknown;
      }
) => {
  expect(!result.ok).toBe(true);
};
test("company members discover and contact the published workspace bot without file grants", async () => {
  await using workspace = await workspaceFixture();
  const { actor, guest, personal, guestPersonal, repository } = workspace;
  const secret = await repository.write(actor, {
    operationId: randomUUID(),
    expectedRevision: null,
    path: "knowledge/secret.md",
    content: "canary-company-secret",
  });
  const bot = await saveWorkspaceBot(actor, profile("Company Zoen"));
  expect(await searchWorkspaceBots(guest, bot.username)).toHaveLength(1);
  expect(await searchWorkspaceBots(personal, bot.username)).toEqual([]);
  const contact = await contactNetworkBot(guest, {
    destUsername: bot.username,
    message: prompt("Hello company bot"),
  });
  expect(contact.network.kind).toBe("company");
  expect(contact.task.round).toBe(1);
  expect(
    (await readWorkspaceToolCatalog(contact.destActor)).tools.map(
      (tool) => tool.path
    )
  ).toEqual([]);
  denied(
    await Promise.try(async () =>
      repository.read(contact.destActor, "knowledge/secret.md", secret.revision)
    ).then(
      (value) => ({
        ok: true as const,
        value,
      }),
      (error: unknown) => ({
        ok: false as const,
        error,
      })
    )
  );
  expect((await repository.read(contact.destActor)).files).not.toContain(
    "knowledge/secret.md"
  );
  const replay = await contactNetworkBot(guest, {
    destUsername: bot.username,
    message: {
      messageId: contact.task.messageId,
      role: "ROLE_USER",
      parts: [
        {
          text: "Hello company bot",
        },
      ],
    },
  });
  expect(replay.task.id).toBe(contact.task.id);
  const other = await contactNetworkBot(actor, {
    destUsername: bot.username,
    message: prompt("Second member"),
  });
  denied(
    await Promise.try(async () =>
      readProtocolTask(contact.destActor, other.task.id)
    ).then(
      (value) => ({
        ok: true as const,
        value,
      }),
      (error: unknown) => ({
        ok: false as const,
        error,
      })
    )
  );
  denied(
    await Promise.try(async () =>
      A2AMessageSchema.strict().parseAsync({
        message: prompt("Forged"),
        networkKind: "company",
      })
    ).then(
      (value) => ({
        ok: true as const,
        value,
      }),
      (error: unknown) => ({
        ok: false as const,
        error,
      })
    )
  );
  denied(
    await Promise.try(async () =>
      ContactNetworkBotSchema.strict().parseAsync({
        destUsername: bot.username,
        message: prompt("Forged"),
        networkKind: "company",
      })
    ).then(
      (value) => ({
        ok: true as const,
        value,
      }),
      (error: unknown) => ({
        ok: false as const,
        error,
      })
    )
  );
  await cancelProtocolTask(contact.destActor, contact.task.id);
  await finishProtocolTask(
    contact.destActor,
    contact.task.id,
    "TASK_STATE_COMPLETED",
    "Late answer"
  );
  expect(
    (await readProtocolTask(contact.destActor, contact.task.id)).state
  ).toBe("TASK_STATE_CANCELED");
  denied(
    await Promise.try(async () =>
      contactNetworkBot(guestPersonal, {
        destUsername: bot.username,
        message: prompt("Personal actor"),
      })
    ).then(
      (value) => ({
        ok: true as const,
        value,
      }),
      (error: unknown) => ({
        ok: false as const,
        error,
      })
    )
  );
});
test("pending invites are not trust, personal accept is required, and block ends the grant", async () => {
  await using workspace = await workspaceFixture();
  const { actor, personal, guestPersonal } = workspace;
  const ana = handle("ana");
  const bruno = handle("bruno");
  await saveDirectoryProfile(personal, {
    username: ana,
    discoverable: true,
  });
  await saveDirectoryProfile(guestPersonal, {
    username: bruno,
    discoverable: true,
  });
  denied(
    await Promise.try(async () =>
      invitePersonalTrust(actor, {
        username: bruno,
      })
    ).then(
      (value) => ({
        ok: true as const,
        value,
      }),
      (error: unknown) => ({
        ok: false as const,
        error,
      })
    )
  );
  const invited = await invitePersonalTrust(personal, {
    username: bruno,
  });
  expect(
    (await listPersonalNetwork(guestPersonal)).invites.map(
      (row) => row.direction
    )
  ).toEqual(["received"]);
  const brunoBot = await saveWorkspaceBot(guestPersonal, profile("Bruno Zoen"));
  expect(await searchWorkspaceBots(personal, brunoBot.username)).toEqual([]);
  denied(
    await Promise.try(async () =>
      contactNetworkBot(personal, {
        destUsername: brunoBot.username,
        message: prompt("Before accept"),
      })
    ).then(
      (value) => ({
        ok: true as const,
        value,
      }),
      (error: unknown) => ({
        ok: false as const,
        error,
      })
    )
  );
  await answerPersonalTrust(guestPersonal, {
    id: invited.id,
    accept: true,
  });
  expect(
    (await listPersonalNetwork(personal)).connections.map((row) => row.username)
  ).toEqual([bruno]);
  expect(await searchWorkspaceBots(personal, brunoBot.username)).toHaveLength(
    1
  );
  const talk = await contactNetworkBot(personal, {
    destUsername: brunoBot.username,
    message: prompt("After accept"),
  });
  expect(talk.network.kind).toBe("personal");
  await blockPersonalTrust(guestPersonal, {
    username: ana,
  });
  denied(
    await Promise.try(async () =>
      contactNetworkBot(personal, {
        destUsername: brunoBot.username,
        message: prompt("After block"),
      })
    ).then(
      (value) => ({
        ok: true as const,
        value,
      }),
      (error: unknown) => ({
        ok: false as const,
        error,
      })
    )
  );
  denied(
    await Promise.try(async () =>
      readWorkspaceToolCatalog(talk.destActor)
    ).then(
      (value) => ({
        ok: true as const,
        value,
      }),
      (error: unknown) => ({
        ok: false as const,
        error,
      })
    )
  );
  denied(
    await Promise.try(async () =>
      invitePersonalTrust(personal, {
        username: bruno,
      })
    ).then(
      (value) => ({
        ok: true as const,
        value,
      }),
      (error: unknown) => ({
        ok: false as const,
        error,
      })
    )
  );
  expect(await searchWorkspaceBots(personal, brunoBot.username)).toEqual([]);
});
test("trust is not transitive and two company networks stay separate", async () => {
  await using workspace = await workspaceFixture();
  const { actor, guest, personal, guestPersonal } = workspace;
  const ana = handle("ana");
  const bruno = handle("bruno");
  const carlaName = handle("carla");
  await saveDirectoryProfile(personal, {
    username: ana,
    discoverable: true,
  });
  await saveDirectoryProfile(guestPersonal, {
    username: bruno,
    discoverable: true,
  });
  const carlaRaw = `carla-${randomUUID()}`;
  const carlaSession = randomUUID();
  const carlaScope = accessScopeForUser(`better-auth:${carlaRaw}`);
  onTestFinished(async () => {
    await query(
      sql`DELETE FROM workspaces WHERE id = ${carlaScope.workspaceId}`
    );
    await query(sql`DELETE FROM public.user WHERE id = ${carlaRaw}`);
  });
  await query(sql`INSERT INTO public.user (id, name, email) VALUES
        (${carlaRaw}, 'Carla', ${`${carlaRaw}@example.invalid`})`);
  await query(sql`INSERT INTO public.session (id, token, "userId", "expiresAt", "updatedAt") VALUES
        (${carlaSession}, ${carlaSession}, ${carlaRaw}, now() + interval '1 hour', now())`);
  await query(
    sql`INSERT INTO workspaces (id, organization_id) VALUES (${carlaScope.workspaceId}, NULL)`
  );
  await query(sql`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES
        (${carlaScope.workspaceId}, ${carlaScope.userId}, 'owner')`);
  const carla = {
    userId: carlaScope.userId,
    workspaceId: carlaScope.workspaceId,
    authSessionId: carlaSession,
  };
  await saveDirectoryProfile(carla, {
    username: carlaName,
    discoverable: true,
  });
  const first = await invitePersonalTrust(personal, {
    username: bruno,
  });
  await answerPersonalTrust(guestPersonal, {
    id: first.id,
    accept: true,
  });
  const second = await invitePersonalTrust(guestPersonal, {
    username: carlaName,
  });
  await answerPersonalTrust(carla, {
    id: second.id,
    accept: true,
  });
  const carlaBot = await saveWorkspaceBot(carla, profile("Carla Zoen"));
  expect(await searchWorkspaceBots(personal, carlaBot.username)).toEqual([]);
  denied(
    await Promise.try(async () =>
      contactNetworkBot(personal, {
        destUsername: carlaBot.username,
        message: prompt("Inherited trust"),
      })
    ).then(
      (value) => ({
        ok: true as const,
        value,
      }),
      (error: unknown) => ({
        ok: false as const,
        error,
      })
    )
  );
  await endPersonalTrust(personal, {
    username: bruno,
  });
  const orgB = `org-b-${randomUUID()}`;
  const teamB = `team-b-${randomUUID()}`;
  onTestFinished(async () => {
    await query(sql`DELETE FROM workspaces WHERE id = ${teamB}`);
    await query(sql`DELETE FROM organizations WHERE id = ${orgB}`);
  });
  await query(
    sql`INSERT INTO organizations (id, name) VALUES (${orgB}, 'Second company')`
  );
  await query(
    sql`INSERT INTO workspaces (id, organization_id) VALUES (${teamB}, ${orgB})`
  );
  await query(sql`INSERT INTO organization_memberships (organization_id, user_id, role) VALUES
        (${orgB}, ${guest.userId}, 'admin'), (${orgB}, ${actor.userId}, 'member')`);
  await query(sql`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES
        (${teamB}, ${guest.userId}, 'admin'), (${teamB}, ${actor.userId}, 'member')`);
  const companyB = {
    ...guest,
    workspaceId: teamB,
  };
  const botB = await saveWorkspaceBot(companyB, profile("Second Zoen"));
  expect(await searchWorkspaceBots(actor, botB.username)).toEqual([]);
  denied(
    await Promise.try(async () =>
      contactNetworkBot(actor, {
        destUsername: botB.username,
        message: prompt("Wrong company"),
      })
    ).then(
      (value) => ({
        ok: true as const,
        value,
      }),
      (error: unknown) => ({
        ok: false as const,
        error,
      })
    )
  );
  expect(
    await searchWorkspaceBots(
      {
        ...actor,
        workspaceId: teamB,
      },
      botB.username
    )
  ).toHaveLength(1);
});
test("removing a member revokes their network conversation and unpublished personal bots stay off the company network", async () => {
  await using workspace = await workspaceFixture();
  const { actor, guest, personal } = workspace;
  const companyBot = await saveWorkspaceBot(actor, profile("Company Zoen"));
  const personalBot = await saveWorkspaceBot(
    personal,
    profile("Personal Zoen")
  );
  expect(await searchWorkspaceBots(guest, personalBot.username)).toEqual([]);
  denied(
    await Promise.try(async () =>
      contactNetworkBot(guest, {
        destUsername: personalBot.username,
        message: prompt("Personal bot at work"),
      })
    ).then(
      (value) => ({
        ok: true as const,
        value,
      }),
      (error: unknown) => ({
        ok: false as const,
        error,
      })
    )
  );
  const talk = await contactNetworkBot(guest, {
    destUsername: companyBot.username,
    message: prompt("Pending work"),
  });
  await removeWorkspaceMember(actor, guest.userId);
  denied(
    await Promise.try(async () =>
      readWorkspaceToolCatalog(talk.destActor)
    ).then(
      (value) => ({
        ok: true as const,
        value,
      }),
      (error: unknown) => ({
        ok: false as const,
        error,
      })
    )
  );
  denied(
    await Promise.try(async () =>
      contactNetworkBot(guest, {
        destUsername: companyBot.username,
        message: prompt("After removal"),
      })
    ).then(
      (value) => ({
        ok: true as const,
        value,
      }),
      (error: unknown) => ({
        ok: false as const,
        error,
      })
    )
  );
  denied(
    await Promise.try(async () =>
      searchWorkspaceBots(guest, companyBot.username)
    ).then(
      (value) => ({
        ok: true as const,
        value,
      }),
      (error: unknown) => ({
        ok: false as const,
        error,
      })
    )
  );
});
test("bot-to-bot chains stop at eight rounds and a pending company invite cannot use the network", async () => {
  await using workspace = await workspaceFixture();
  const { actor, personal, guestPersonal } = workspace;
  const outsiderRaw = `invitee-${randomUUID()}`;
  const outsiderSession = randomUUID();
  const outsiderScope = accessScopeForUser(`better-auth:${outsiderRaw}`);
  onTestFinished(async () => {
    await query(
      sql`DELETE FROM workspaces WHERE id = ${outsiderScope.workspaceId}`
    );
    await query(sql`DELETE FROM public.user WHERE id = ${outsiderRaw}`);
  });
  await query(sql`INSERT INTO public.user (id, name, email) VALUES
        (${outsiderRaw}, 'Invitee', ${`${outsiderRaw}@example.invalid`})`);
  await query(sql`INSERT INTO public.session (id, token, "userId", "expiresAt", "updatedAt") VALUES
        (${outsiderSession}, ${outsiderSession}, ${outsiderRaw}, now() + interval '1 hour', now())`);
  await query(
    sql`INSERT INTO workspaces (id, organization_id) VALUES (${outsiderScope.workspaceId}, NULL)`
  );
  await query(sql`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES
        (${outsiderScope.workspaceId}, ${outsiderScope.userId}, 'owner')`);
  const outsider = {
    userId: outsiderScope.userId,
    workspaceId: outsiderScope.workspaceId,
    authSessionId: outsiderSession,
  };
  const invitee = handle("inv");
  await saveDirectoryProfile(outsider, {
    username: invitee,
    discoverable: true,
  });
  await inviteWorkspaceMember(actor, invitee);
  const companyBot = await saveWorkspaceBot(actor, profile("Company Zoen"));
  denied(
    await Promise.try(async () =>
      searchWorkspaceBots(
        {
          ...outsider,
          workspaceId: actor.workspaceId,
        },
        companyBot.username
      )
    ).then(
      (value) => ({
        ok: true as const,
        value,
      }),
      (error: unknown) => ({
        ok: false as const,
        error,
      })
    )
  );
  const ana = handle("ana");
  const bruno = handle("bruno");
  await saveDirectoryProfile(personal, {
    username: ana,
    discoverable: true,
  });
  await saveDirectoryProfile(guestPersonal, {
    username: bruno,
    discoverable: true,
  });
  const invited = await invitePersonalTrust(personal, {
    username: bruno,
  });
  await answerPersonalTrust(guestPersonal, {
    id: invited.id,
    accept: true,
  });
  const anaBot = await saveWorkspaceBot(personal, profile("Ana Zoen"));
  const brunoBot = await saveWorkspaceBot(guestPersonal, profile("Bruno Zoen"));
  let last = await contactNetworkBot(personal, {
    destUsername: brunoBot.username,
    message: prompt("Round 1"),
  });
  const first = last.task.correlationId;
  for (let round = 2; round <= 8; round++) {
    const from = round % 2 === 0 ? guestPersonal : personal;
    const destUsername = round % 2 === 0 ? anaBot.username : brunoBot.username;
    last = await contactNetworkBot(from, {
      destUsername,
      originTaskId: last.task.id,
      message: prompt(`Round ${String(round)}`),
    });
    expect(last.task.round).toBe(round);
    expect(last.task.correlationId).toBe(first);
  }
  const ninth = await Promise.try(async () =>
    contactNetworkBot(personal, {
      destUsername: brunoBot.username,
      originTaskId: last.task.id,
      message: prompt("Round 9"),
    })
  ).then(
    (value) => ({
      ok: true as const,
      value,
    }),
    (error: unknown) => ({
      ok: false as const,
      error,
    })
  );
  expect(!ninth.ok && ninth.error).toBeInstanceOf(A2AError);
});
test("review #116: organization membership allows contact without granting project files", async () => {
  await using workspace = await workspaceFixture();
  const { actor, guest, repository } = workspace;
  const secondWorkspaceId = `review-project-${randomUUID()}`;
  const org = await query<{
    organization_id: string;
  }>(
    sql`SELECT organization_id FROM workspaces WHERE id = ${actor.workspaceId}`
  );
  const organizationId = org[0]?.organization_id;
  if (!organizationId) throw new Error("Company fixture missing");
  onTestFinished(async () => {
    await query(sql`DELETE FROM workspaces WHERE id = ${secondWorkspaceId}`);
  });
  await query(
    sql`INSERT INTO workspaces(id, organization_id) VALUES (${secondWorkspaceId}, ${organizationId})`
  );
  await query(
    sql`INSERT INTO workspace_memberships(workspace_id, user_id, role) VALUES (${secondWorkspaceId}, ${actor.userId}, 'admin')`
  );
  const destination = {
    ...actor,
    workspaceId: secondWorkspaceId,
  };
  const bot = await saveWorkspaceBot(destination, {
    username: `review${randomUUID().replaceAll("-", "").slice(0, 14)}`,
    name: "Published company bot",
    description: "Synthetic review",
    discoverable: true,
  });
  await repository.write(destination, {
    operationId: randomUUID(),
    expectedRevision: null,
    path: "knowledge/private.md",
    content: "project-private-canary",
  });
  const listed = await searchWorkspaceBots(guest, bot.username);
  const contact = await Promise.try(async () =>
    contactNetworkBot(guest, {
      destUsername: bot.username,
      message: {
        messageId: randomUUID(),
        role: "ROLE_USER",
        parts: [
          {
            text: "Hello colleague",
          },
        ],
      },
    })
  ).then(
    (value) => ({
      ok: true as const,
      value,
    }),
    (error: unknown) => ({
      ok: false as const,
      error,
    })
  );
  expect({
    discoverable: listed.length,
    contactAllowed: contact.ok,
  }).toEqual({
    discoverable: 1,
    contactAllowed: true,
  });
  if (!contact.ok) throw contact.error;
  {
    const file = await Promise.try(async () =>
      repository.read(contact.value.destActor, "knowledge/private.md")
    ).then(
      (value) => ({
        ok: true as const,
        value,
      }),
      (error: unknown) => ({
        ok: false as const,
        error,
      })
    );
    expect(!file.ok).toBe(true);
  }
});
