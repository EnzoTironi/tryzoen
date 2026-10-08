import { randomUUID, createHmac } from "node:crypto";
import { afterAll, expect, test, vi } from "vitest";
import { sql } from "drizzle-orm";
import { query, transaction } from "@db/queries";
import { env } from "@shared/environment/env";
import { workspaceFixture } from "./workspace-fixture";
import {
  WorkspaceAccessDenied,
  type WorkspaceActorSchema,
} from "../../server/workspaces/access";
import type { z } from "zod";
import { WorkspaceRepository } from "../../server/workspaces/repository";
import { PrivateMemoryRepository } from "../../server/memory/repository";
import {
  commandMastraPilot,
  readMastraPilot,
  downloadMastraNote,
} from "../../server/mastra/pilot";
import { mastraPilotRuntime } from "../../server/mastra/runtime";
import {
  requestAccountDeletion,
  applyAccountDeletionTombstones,
} from "../../server/accounts/deletion";
import { ErasureJournal } from "../../server/accounts/erasure-journal";

const modelGate = vi.hoisted(() => ({
  started: Promise.withResolvers<void>(),
  release: Promise.withResolvers<void>(),
}));

// Only the external model is scripted. Auth, Mastra, PostgreSQL, citations and Git are real.
vi.mock("../../server/mastra/codex", async () => {
  const { MockLanguageModelV3 } = await import("ai/test");
  type Part =
    Awaited<
      ReturnType<InstanceType<typeof MockLanguageModelV3>["doStream"]>
    >["stream"] extends ReadableStream<infer Item>
      ? Item
      : never;
  return {
    codexPilotModel: () =>
      new MockLanguageModelV3({
        doStream: async ({ prompt }) => {
          const message = prompt.at(-1);
          const text =
            message?.role === "user"
              ? message.content
                  .flatMap((item) => (item.type === "text" ? [item.text] : []))
                  .join(" ")
              : "";
          const remembering = text.startsWith("Lembre:");
          if (text.startsWith("Bloqueie:")) {
            modelGate.started.resolve();
            await modelGate.release.promise;
          }
          const proposal = text.length > 0;
          const parts: Part[] = proposal
            ? [
                {
                  type: "tool-call",
                  toolCallId: randomUUID(),
                  toolName: remembering ? "proposeMemory" : "proposeNote",
                  input: JSON.stringify(
                    remembering
                      ? {
                          text: "O usuário é vegetariano.",
                          excerpt: "sou vegetariano",
                        }
                      : {
                          title: "Jantar",
                          content: JSON.stringify(prompt).includes(
                            "O usuário é vegetariano."
                          )
                            ? "Curry vegetariano de grão-de-bico."
                            : "Uma nota para revisar.",
                        }
                  ),
                },
              ]
            : [];
          parts.push({
            type: "finish",
            finishReason: {
              unified: proposal ? "tool-calls" : "stop",
              raw: undefined,
            },
            usage: {
              inputTokens: {
                total: 10,
                noCache: 10,
                cacheRead: undefined,
                cacheWrite: undefined,
              },
              outputTokens: { total: 10, text: 10, reasoning: undefined },
            },
          });
          return {
            stream: new ReadableStream<Part>({
              start(controller) {
                for (const part of parts) controller.enqueue(part);
                controller.close();
              },
            }),
          };
        },
      }),
  };
});

function headers(actor: z.output<typeof WorkspaceActorSchema>) {
  const secret = env.BETTER_AUTH_SECRET;
  const sessionId = actor.authSessionId;
  if (!secret || !sessionId)
    throw new Error(
      "Configure BETTER_AUTH_SECRET for authenticated integration tests."
    );
  const signature = createHmac("sha256", secret)
    .update(sessionId)
    .digest("base64");
  return new Headers({
    cookie: `better-auth.session_token=${encodeURIComponent(sessionId + "." + signature)}`,
  });
}
async function propose(
  actor: z.output<typeof WorkspaceActorSchema>,
  text = "Prepare uma nota."
) {
  const auth = headers(actor);
  const created = await commandMastraPilot(auth, { command: "create" });
  if (!created.conversationId) throw new Error("Expected conversation");
  const view = await commandMastraPilot(auth, {
    command: "send",
    conversationId: created.conversationId,
    runId: randomUUID(),
    text,
  });
  const run = view.runs.at(-1);
  if (!run?.plan?.action || run.status !== "suspended")
    throw new Error("Expected suspended proposal");
  return { auth, run };
}
afterAll(async () => {
  const { storage } = await mastraPilotRuntime();
  await storage.close();
});

async function nativeRows(
  actor: z.output<typeof WorkspaceActorSchema>,
  runIds: string[]
) {
  const [rows] = await query(sql`SELECT
    (SELECT count(*)::int FROM mastra_pilot.mastra_threads WHERE "resourceId"=${actor.workspaceId}) AS threads,
    (SELECT count(*)::int FROM mastra_pilot.mastra_messages WHERE "resourceId"=${actor.workspaceId}) AS messages,
    (SELECT count(*)::int FROM mastra_pilot.mastra_resources WHERE id=${actor.workspaceId}) AS resources,
    (SELECT count(*)::int FROM mastra_pilot.mastra_observational_memory WHERE "resourceId"=${actor.workspaceId}) AS observations,
    (SELECT count(*)::int FROM mastra_pilot.mastra_workflow_snapshot WHERE run_id IN (${sql.join(
      runIds.map((id) => sql`${id}`),
      sql`, `
    )})) AS workflows`);
  return rows;
}

async function nativeResource(actor: z.output<typeof WorkspaceActorSchema>) {
  const { storage } = await mastraPilotRuntime();
  const store = await storage.getStore("memory");
  if (!store) throw new Error("Expected native memory storage");
  await store.saveResource({
    resource: {
      id: actor.workspaceId,
      workingMemory: "Synthetic retained resource.",
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  await store.initializeObservationalMemory({
    resourceId: actor.workspaceId,
    threadId: null,
    scope: "resource",
    config: {},
  });
  return store;
}

test("canonical cited preference is approved once and used by a new conversation", async () => {
  await using fixture = await workspaceFixture();
  const { auth, run } = await propose(
    fixture.personal,
    "Lembre: sou vegetariano."
  );
  expect(
    (await PrivateMemoryRepository.read(fixture.personal)).snapshot.claims
  ).toHaveLength(0);
  const accepted = await commandMastraPilot(auth, {
    command: "decide",
    runId: run.runId,
    approved: true,
  });
  expect(accepted.runs.at(-1)?.status).toBe("completed");
  const claims = (await PrivateMemoryRepository.read(fixture.personal)).snapshot
    .claims;
  expect(claims).toHaveLength(1);
  expect(claims[0]?.file.state).toMatchObject({
    kind: "active",
    body: {
      text: "O usuário é vegetariano.",
      sources: [
        {
          kind: "session",
          sessionId: run.conversationId,
          eventId: run.runId,
          excerpt: "sou vegetariano",
        },
      ],
    },
  });
  expect(
    (
      await commandMastraPilot(auth, {
        command: "decide",
        runId: run.runId,
        approved: true,
      })
    ).runs.at(-1)?.result
  ).toEqual(accepted.runs.at(-1)?.result);
  const next = await propose(fixture.personal);
  expect(next.run.plan?.action).toMatchObject({
    kind: "note",
    content: "Curry vegetariano de grão-de-bico.",
  });
});

test("approval writes the reviewed note once and downloads the exact committed revision", async () => {
  await using fixture = await workspaceFixture();
  const { auth, run } = await propose(fixture.personal);
  const action = run.plan?.action;
  if (action?.kind !== "note") throw new Error("Expected note");
  expect(
    (await WorkspaceRepository.read(fixture.personal, action.path)).content
  ).toBeNull();
  const accepted = await commandMastraPilot(auth, {
    command: "decide",
    runId: run.runId,
    approved: true,
  });
  expect(accepted.runs.at(-1)?.status).toBe("completed");
  const written = await WorkspaceRepository.read(fixture.personal, action.path);
  expect(written.content).toBe(`# ${action.title}\n\n${action.content}\n`);
  const repeated = await commandMastraPilot(auth, {
    command: "decide",
    runId: run.runId,
    approved: true,
  });
  expect(repeated.runs.at(-1)?.result).toEqual(accepted.runs.at(-1)?.result);
  expect(
    (await WorkspaceRepository.read(fixture.personal, action.path)).revision
  ).toBe(written.revision);
  const download = await downloadMastraNote(auth, run.runId);
  expect(download.headers.get("cache-control")).toBe("private, no-store");
  expect(await download.text()).toBe(written.content);
});

test("rejection and cancellation keep the proposed note absent", async () => {
  await using fixture = await workspaceFixture();
  for (const command of ["reject", "cancel"] as const) {
    const { auth, run } = await propose(fixture.personal);
    const view = await commandMastraPilot(
      auth,
      command === "reject"
        ? { command: "decide", runId: run.runId, approved: false }
        : { command: "cancel", runId: run.runId }
    );
    expect(view.runs.at(-1)?.status).toBe(
      command === "reject" ? "rejected" : "cancelled"
    );
    const action = run.plan?.action;
    if (action?.kind !== "note") throw new Error("Expected note");
    expect(
      (await WorkspaceRepository.read(fixture.personal, action.path)).content
    ).toBeNull();
    expect(
      (
        await commandMastraPilot(auth, {
          command: "decide",
          runId: run.runId,
          approved: true,
        })
      ).runs.at(-1)?.result?.receipt ?? null
    ).toBeNull();
  }
});

test("a different account cannot read, approve or download another account's run", async () => {
  await using fixture = await workspaceFixture();
  const { auth, run } = await propose(fixture.personal);
  const guest = headers(fixture.guestPersonal);
  await expect(
    readMastraPilot(guest, run.conversationId)
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  await expect(
    commandMastraPilot(guest, {
      command: "decide",
      runId: run.runId,
      approved: true,
    })
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  await commandMastraPilot(auth, {
    command: "decide",
    runId: run.runId,
    approved: true,
  });
  await expect(downloadMastraNote(guest, run.runId)).rejects.toBeInstanceOf(
    WorkspaceAccessDenied
  );
});

test("revoking the Zoen session before approval prevents a suspended write", async () => {
  await using fixture = await workspaceFixture();
  const { auth, run } = await propose(fixture.personal);
  await query(
    sql`DELETE FROM public.session WHERE id=${fixture.personal.authSessionId}`
  );
  await expect(
    commandMastraPilot(auth, {
      command: "decide",
      runId: run.runId,
      approved: true,
    })
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  const rows = await query(
    sql`SELECT revision FROM workspace_revision WHERE workspace_id=${fixture.personal.workspaceId}`
  );
  expect(rows).toHaveLength(0);
});

test("a new valid login replaces the revoked session stored in a pending checkpoint", async () => {
  await using fixture = await workspaceFixture();
  const { run } = await propose(fixture.personal);
  const newSessionId = randomUUID();
  await query(
    sql`DELETE FROM public.session WHERE id=${fixture.personal.authSessionId}`
  );
  await query(
    sql`INSERT INTO public.session (id,token,"userId","expiresAt","updatedAt") VALUES (${newSessionId},${newSessionId},${fixture.personal.userId.slice("better-auth:".length)},now()+interval '1 hour',now())`
  );
  const fresh = headers({ ...fixture.personal, authSessionId: newSessionId });
  expect(
    (
      await commandMastraPilot(fresh, {
        command: "decide",
        runId: run.runId,
        approved: true,
      })
    ).runs.at(-1)?.status
  ).toBe("completed");
});

test("cancelling while the model is running prevents any later proposal from committing", async () => {
  await using fixture = await workspaceFixture();
  const auth = headers(fixture.personal);
  const created = await commandMastraPilot(auth, { command: "create" });
  if (!created.conversationId) throw new Error("Expected conversation");
  const runId = randomUUID();
  const pending = commandMastraPilot(auth, {
    command: "send",
    conversationId: created.conversationId,
    runId,
    text: "Bloqueie: prepare uma nota.",
  });
  await modelGate.started.promise;
  try {
    const cancelled = await commandMastraPilot(auth, {
      command: "cancel",
      runId,
    });
    expect(cancelled.runs.at(-1)?.status).toBe("cancelled");
  } finally {
    modelGate.release.resolve();
  }
  expect((await pending).runs.at(-1)?.status).toBe("cancelled");
  expect(
    await query(
      sql`SELECT revision FROM workspace_revision WHERE workspace_id=${fixture.personal.workspaceId}`
    )
  ).toHaveLength(0);
});

test("native checkpoints repair a ledger left behind at suspension or completion", async () => {
  await using fixture = await workspaceFixture();
  const { auth, run } = await propose(fixture.personal);
  await query(
    sql`UPDATE mastra_pilot_run SET status='running' WHERE id=${run.runId}`
  );
  expect(
    (await readMastraPilot(auth, run.conversationId)).runs.at(-1)?.status
  ).toBe("suspended");
  await commandMastraPilot(auth, {
    command: "decide",
    runId: run.runId,
    approved: true,
  });
  await query(
    sql`UPDATE mastra_pilot_run SET status='running' WHERE id=${run.runId}`
  );
  expect(
    (await readMastraPilot(auth, run.conversationId)).runs.at(-1)?.status
  ).toBe("completed");
  expect(
    (
      await commandMastraPilot(auth, {
        command: "decide",
        runId: run.runId,
        approved: true,
      })
    ).runs.at(-1)?.result?.receipt?.operationId
  ).toBe(run.runId);
});

test("replaying the same send returns its proposal and a second active send is rejected", async () => {
  await using fixture = await workspaceFixture();
  const { auth, run } = await propose(fixture.personal);
  const replay = await commandMastraPilot(auth, {
    command: "send",
    runId: run.runId,
    conversationId: run.conversationId,
    text: run.input,
  });
  expect(replay.runs.at(-1)?.plan).toEqual(run.plan);
  await expect(
    commandMastraPilot(auth, {
      command: "send",
      runId: randomUUID(),
      conversationId: run.conversationId,
      text: "Mais uma nota.",
    })
  ).rejects.toMatchObject({ name: "PilotBusy" });
});

test("account deletion erases native storage and fences delayed writes without touching another account", async () => {
  await using fixture = await workspaceFixture();
  const pending = await propose(fixture.guestPersonal);
  const completed = await propose(fixture.guestPersonal);
  await commandMastraPilot(completed.auth, {
    command: "decide",
    runId: completed.run.runId,
    approved: true,
  });
  const survivor = await propose(fixture.personal);
  const memory = await nativeResource(fixture.guestPersonal);
  await nativeResource(fixture.personal);
  const ids = [pending.run.runId, completed.run.runId];
  const survivorBefore = await nativeRows(fixture.personal, [
    survivor.run.runId,
  ]);
  expect(await nativeRows(fixture.guestPersonal, ids)).toMatchObject({
    threads: 2,
    resources: 1,
    observations: 1,
    workflows: 2,
  });
  const { storage, mastra } = await mastraPilotRuntime();
  const workflows = await storage.getStore("workflows");
  if (!workflows) throw new Error("Expected native workflow storage");
  const workflowName = mastra.getWorkflow("pilot").id;
  const snapshot = await workflows.loadWorkflowSnapshot({
    workflowName,
    runId: pending.run.runId,
  });
  if (!snapshot) throw new Error("Expected native checkpoint");
  const retainedThread = await memory.getThreadById({
    threadId: pending.run.conversationId,
  });
  if (!retainedThread) throw new Error("Expected native thread");

  await requestAccountDeletion(fixture.guestPersonal);
  const erased = {
    threads: 0,
    messages: 0,
    resources: 0,
    observations: 0,
    workflows: 0,
  };
  expect(await nativeRows(fixture.guestPersonal, ids)).toEqual(erased);
  await expect(readMastraPilot(pending.auth)).rejects.toBeInstanceOf(
    WorkspaceAccessDenied
  );
  await expect(
    commandMastraPilot(pending.auth, {
      command: "decide",
      runId: pending.run.runId,
      approved: true,
    })
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  await expect(memory.saveThread({ thread: retainedThread })).rejects.toThrow(
    "violates foreign key constraint"
  );
  await expect(
    workflows.persistWorkflowSnapshot({
      workflowName,
      runId: pending.run.runId,
      snapshot,
    })
  ).rejects.toThrow("violates foreign key constraint");
  expect(await nativeRows(fixture.guestPersonal, ids)).toEqual(erased);
  expect(await nativeRows(fixture.personal, [survivor.run.runId])).toEqual(
    survivorBefore
  );
  expect(
    (await readMastraPilot(survivor.auth, survivor.run.conversationId)).runs.at(
      -1
    )?.plan
  ).toEqual(survivor.run.plan);
});

test("the immutable account tombstone erases native content returned by a database rollback", async () => {
  await using fixture = await workspaceFixture();
  const { auth, run } = await propose(fixture.guestPersonal);
  await nativeResource(fixture.guestPersonal);
  const before = await nativeRows(fixture.guestPersonal, [run.runId]);
  const rollback = new Error("Synthetic database restoration");
  await expect(
    transaction(async () => {
      await ErasureJournal.append({
        userId: fixture.guestPersonal.userId,
        matrixIds: [],
        departures: [],
      });
      await query(
        sql`DELETE FROM workspaces WHERE id=${fixture.guestPersonal.workspaceId}`
      );
      expect(await nativeRows(fixture.guestPersonal, [run.runId])).toEqual({
        threads: 0,
        messages: 0,
        resources: 0,
        observations: 0,
        workflows: 0,
      });
      throw rollback;
    })
  ).rejects.toBe(rollback);
  expect(await nativeRows(fixture.guestPersonal, [run.runId])).toEqual(before);
  await applyAccountDeletionTombstones();
  expect(await nativeRows(fixture.guestPersonal, [run.runId])).toEqual({
    threads: 0,
    messages: 0,
    resources: 0,
    observations: 0,
    workflows: 0,
  });
  await expect(readMastraPilot(auth)).rejects.toBeInstanceOf(
    WorkspaceAccessDenied
  );
});

test("deletion while the model is running prevents messages and checkpoints from returning", async () => {
  await using fixture = await workspaceFixture();
  modelGate.started = Promise.withResolvers<void>();
  modelGate.release = Promise.withResolvers<void>();
  const auth = headers(fixture.guestPersonal);
  const created = await commandMastraPilot(auth, { command: "create" });
  if (!created.conversationId) throw new Error("Expected conversation");
  const runId = randomUUID();
  const pending = commandMastraPilot(auth, {
    command: "send",
    conversationId: created.conversationId,
    runId,
    text: "Bloqueie: prepare uma nota.",
  });
  const settled = pending.then(
    () => ({ success: true, error: null }),
    (error: unknown) => ({ success: false, error })
  );
  await modelGate.started.promise;
  try {
    await requestAccountDeletion(fixture.guestPersonal);
    expect(await nativeRows(fixture.guestPersonal, [runId])).toEqual({
      threads: 0,
      messages: 0,
      resources: 0,
      observations: 0,
      workflows: 0,
    });
  } finally {
    modelGate.release.resolve();
  }
  const outcome = await settled;
  expect(outcome.success).toBe(false);
  expect(outcome.error).toBeInstanceOf(WorkspaceAccessDenied);
  expect(await nativeRows(fixture.guestPersonal, [runId])).toEqual({
    threads: 0,
    messages: 0,
    resources: 0,
    observations: 0,
    workflows: 0,
  });
});
