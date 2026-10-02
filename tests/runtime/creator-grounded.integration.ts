import {
  readCreatorQualificationCandidate,
  listCreatorQualifications,
  approveCreatorQualification,
} from "../../server/creators/qualifications";
import { saveDirectoryProfile } from "../../server/accounts/directory";
import {
  listCreatorPilots,
  readCreatorPilot,
  actOnCreatorPilot,
  inviteCreatorPilot,
} from "../../server/creators/pilots";
import { readCreatorDraft } from "../../server/creators/drafts";
import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { z } from "zod";
import { inputRequestSchema } from "eve/client";
import { freePort } from "../helpers/ports";
import {
  compileEveFixture,
  clearFixtureWorkflows,
  runtime,
} from "./eve-fixture";
import { workspaceFixture, workspaceExecutionFor } from "./workspace-fixture";
import { reviewedCreatorVersion } from "../helpers/creator-release";
import { saveCreatorDraft } from "../../server/creators/drafts";
import { approveCreatorRelease } from "../../server/creators/releases";
import { buildCreatorCorpus } from "../../server/creators/corpus/index";
import { saveCreatorEvaluation } from "../../server/creators/evaluation";
import {
  createCreatorPreview,
  exportCreatorPreview,
  claimCreatorPreview,
  finishCreatorPreview,
} from "../../server/creators/previews";
import { readCreatorReleaseCandidate } from "../../server/creators/release-candidate";
const { archive } = await vi.hoisted(async () => {
  const { mkdtemp: makeDirectory } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const paths = await import("node:path");
  const temporary = await makeDirectory(paths.join(tmpdir(), "zoen-grounded-"));
  process.env.ZOEN_SESSION_ARCHIVE_DIR = temporary;
  return { archive: temporary };
});
vi.mock("@shared/environment/env", async (original) => {
  const actual = await original<typeof import("@shared/environment/env")>();
  return {
    ...actual,
    env: { ...actual.env, ZOEN_SESSION_ARCHIVE_DIR: archive },
  };
});
let directory: string;
beforeAll(async () => {
  await clearFixtureWorkflows();
  const fixtures = fileURLToPath(new URL("../fixtures/", import.meta.url));
  directory = await mkdtemp(join(fixtures, ".eve-grounded-"));
  for (const name of ["agent", "package.json", "tsconfig.json"])
    await cp(join(fixtures, "eve-runtime", name), join(directory, name), {
      recursive: true,
    });
  for (const name of [
    "creator-preview",
    "creator-library",
    "creator-review",
    "creator-qualification",
    "creator-pilot",
  ]) {
    const text = await readFile(
      new URL(`../../agent/tools/${name}.ts`, import.meta.url),
      "utf8"
    );
    await writeFile(
      join(directory, `agent/tools/${name}.ts`),
      text
        .replaceAll('"../../server/', '"../../../../../server/')
        .replaceAll(
          '"../lib/workspace-operation"',
          '"../../../../../agent/lib/workspace-operation"'
        )
    );
  }
  await cp(
    new URL(
      "../../agent/subagents/creator-specialist/instructions.md",
      import.meta.url
    ),
    join(directory, "agent/subagents/creator-specialist/instructions.md")
  );
  await compileEveFixture(directory);
}, 90000);
afterAll(async () => {
  await clearFixtureWorkflows();
  if (directory) await rm(directory, { recursive: true, force: true });
  await rm(archive, { recursive: true, force: true });
});

async function approved(actor: Parameters<typeof saveCreatorDraft>[0]) {
  const draft = await saveCreatorDraft(actor, {
    id: randomUUID(),
    expectedRevision: null,
    content: {
      title: "Grounded fixture",
      description: "Synthetic",
      playbook: "Be concise; abstain without evidence.",
      examples: [
        {
          id: randomUUID(),
          title: "Cerulean rule",
          content: "Cerulean harvest happens every forty days.",
          source: "Original fictional source",
          rights: "original",
        },
      ],
    },
  });
  const reviewed = await reviewedCreatorVersion(actor, draft);
  const release = await approveCreatorRelease(actor, reviewed.input);
  await buildCreatorCorpus(actor, release.id);
  const saved = await saveCreatorEvaluation(actor, {
    draftId: draft.id,
    expectedRevision: reviewed.input.evaluationRevision,
    cases: [
      {
        id: randomUUID(),
        title: "Grounded question",
        question: "When is the Cerulean harvest?",
        criteria:
          "Cite the fictional forty-day interval; no unsupported claims.",
      },
    ],
  });
  if (!saved.evaluation) throw new Error("Expected evaluation");
  const item = saved.evaluation.cases[0];
  if (!item) throw new Error("Expected case");
  const request = {
    id: randomUUID(),
    draftId: draft.id,
    revision: draft.revision,
    kind: "grounded-answer" as const,
    releaseId: release.id,
    question: item.question,
    caseRef: { id: item.id, revision: saved.evaluation.revision },
  };
  return { request, release };
}

test("real approved manifest evidence reaches isolated structured specialist and human review survives restart without qualifying snapshot release", async () => {
  await using workspace = await workspaceFixture();
  const { request } = await approved(workspace.personal);
  const preview = await createCreatorPreview(workspace.personal, request);
  expect(preview.answerMode).toBe("grounded");
  expect(preview.grounding?.citations[0]?.excerpt).toContain("forty days");
  const server = await runtime(await freePort(), "127.0.0.1", directory);
  const auth = workspaceExecutionFor(workspace.personal).session.auth.current;
  const { sessionId } = z.object({ sessionId: z.string() }).parse(
    await server.request("/probe/send", {
      address: randomUUID(),
      id: randomUUID(),
      message: "ROOT-PRIVATE-CONTEXT-MUST-NOT-CROSS",
      auth,
    })
  );
  await server.settled(sessionId);
  await server.request(`/probe/message/${sessionId}`, {
    message: `preview ${preview.id}`,
    auth,
  });
  const events = await server.settled(sessionId, 2);
  const result = await exportCreatorPreview(workspace.personal, preview.id);
  expect(result.status).toBe("completed");
  expect(result.groundedAnswer).toMatchObject({
    status: "supported",
    citations: ["S1"],
  });
  expect(result.models).toHaveLength(1);
  const child = z
    .object({ childSessionId: z.string() })
    .parse(events.find((event) => event.type === "subagent.called")?.data);
  const childEvents = JSON.stringify(
    await server.request(`/probe/events/${child.childSessionId}`)
  );
  expect(childEvents).toContain("forty days");
  expect(childEvents).not.toContain("ROOT-PRIVATE-CONTEXT-MUST-NOT-CROSS");
  expect(childEvents).not.toContain("Cite the fictional forty-day interval");
  await server.request(`/probe/message/${sessionId}`, {
    message: `creator-review ${preview.id}`,
    auth,
  });
  const waiting = await server.settled(sessionId, 3);
  const verdict = z
    .object({ requests: z.array(inputRequestSchema) })
    .parse(waiting.findLast((event) => event.type === "input.requested")?.data)
    .requests[0];
  if (!verdict) throw new Error("Expected human review");
  expect(JSON.stringify(verdict)).toContain("forty days");
  await server.stop();
  const resumed = await runtime(await freePort(), "127.0.0.1", directory);
  await resumed.request(`/probe/input/${sessionId}`, {
    auth,
    responses: [{ requestId: verdict.requestId, optionId: "useful" }],
  });
  let notesEvents = await resumed.settled(sessionId, 4);
  // Restart can park the same step again before the next human question exists.
  await expect
    .poll(
      async () => {
        notesEvents = await resumed.settled(sessionId, 4);
        const next = z
          .object({ requests: z.array(inputRequestSchema) })
          .parse(
            notesEvents.findLast((event) => event.type === "input.requested")
              ?.data
          ).requests[0];
        return next?.requestId === verdict.requestId ? undefined : next;
      },
      { timeout: 30000 }
    )
    .toMatchObject({
      kind: "question",
      display: "text",
      allowFreeform: true,
      action: {
        toolName: "creator-review",
        callId: verdict.action.callId,
      },
    });
  const notes = z
    .object({ requests: z.array(inputRequestSchema) })
    .parse(
      notesEvents.findLast((event) => event.type === "input.requested")?.data
    ).requests[0];
  if (!notes) throw new Error("Expected notes");
  expect(notes.requestId).not.toBe(verdict.requestId);
  await resumed.request(`/probe/input/${sessionId}`, {
    auth,
    responses: [
      {
        requestId: notes.requestId,
        text: "Human verified exact source support.",
      },
    ],
  });
  await expect
    .poll(
      async () => {
        await resumed.settled(sessionId, 5);
        return (await exportCreatorPreview(workspace.personal, preview.id))
          .review?.content;
      },
      { timeout: 30000 }
    )
    .toMatchObject({
      verdict: "useful",
      notes: "Human verified exact source support.",
    });
  const final = await exportCreatorPreview(workspace.personal, preview.id);
  expect(final.review?.content.verdict).toBe("useful");
  expect(final.grounding).toEqual(preview.grounding);
  expect(
    (await readCreatorReleaseCandidate(workspace.personal, request.draftId))
      .issues.length
  ).toBeGreaterThan(0);
  await resumed.stop();
}, 90000);

test("grounded requests reject foreign access and citations outside frozen evidence", async () => {
  await using workspace = await workspaceFixture();
  const { request } = await approved(workspace.personal);
  await expect(createCreatorPreview(workspace.guest, request)).rejects.toThrow(
    "WorkspaceAccessDenied"
  );
  const preview = await createCreatorPreview(workspace.personal, request);
  await claimCreatorPreview(workspace.personal, preview.id, "citation-worker", {
    sessionId: randomUUID(),
    turnId: "t0",
  });
  await finishCreatorPreview(
    workspace.personal,
    preview.id,
    "citation-worker",
    { status: "supported", answer: "Invented", citations: ["S8"] }
  );
  expect(
    await exportCreatorPreview(workspace.personal, preview.id)
  ).toMatchObject({ status: "failed", response: null, groundedAnswer: null });
}, 90000);

test("no-match packages cannot claim support and revoked owners cannot execute frozen evidence", async () => {
  await using workspace = await workspaceFixture();
  const { request } = await approved(workspace.personal);
  const saved = await saveCreatorEvaluation(workspace.personal, {
    draftId: request.draftId,
    expectedRevision: request.caseRef.revision,
    cases: [
      {
        id: randomUUID(),
        title: "No evidence",
        question: "Zyxnonexistentcanary?",
        criteria: "Abstain without evidence.",
      },
    ],
  });
  if (!saved.evaluation?.cases[0]) throw new Error("Expected no-evidence case");
  const item = saved.evaluation.cases[0];
  const preview = await createCreatorPreview(workspace.personal, {
    ...request,
    id: randomUUID(),
    question: item.question,
    caseRef: { id: item.id, revision: saved.evaluation.revision },
  });
  expect(preview.grounding?.citations).toEqual([]);
  await claimCreatorPreview(workspace.personal, preview.id, "empty-worker", {
    sessionId: randomUUID(),
    turnId: "t0",
  });
  await finishCreatorPreview(workspace.personal, preview.id, "empty-worker", {
    status: "supported",
    answer: "Invented answer",
    citations: [],
  });
  expect(
    await exportCreatorPreview(workspace.personal, preview.id)
  ).toMatchObject({ status: "failed", response: null });
  const abstention = await createCreatorPreview(workspace.personal, {
    ...request,
    id: randomUUID(),
    question: item.question,
    caseRef: { id: item.id, revision: saved.evaluation.revision },
  });
  await claimCreatorPreview(
    workspace.personal,
    abstention.id,
    "abstention-worker",
    { sessionId: randomUUID(), turnId: "t0" }
  );
  await finishCreatorPreview(
    workspace.personal,
    abstention.id,
    "abstention-worker",
    {
      status: "insufficient-evidence",
      answer: "No evidence found.",
      citations: [],
    }
  );
  expect(
    (await exportCreatorPreview(workspace.personal, abstention.id))
      .groundedAnswer?.status
  ).toBe("insufficient-evidence");
  const next = await createCreatorPreview(workspace.personal, {
    ...request,
    id: randomUUID(),
    question: item.question,
    caseRef: { id: item.id, revision: saved.evaluation.revision },
  });
  await query(
    sql`DELETE FROM public.session WHERE id=${workspace.personal.authSessionId}`
  );
  await expect(
    claimCreatorPreview(workspace.personal, next.id, "revoked-worker", {
      sessionId: randomUUID(),
      turnId: "t0",
    })
  ).rejects.toThrow("WorkspaceAccessDenied");
}, 90000);

test("invented citations from the actual specialist workflow finish failed without saving model prose", async () => {
  await using workspace = await workspaceFixture();
  const { request } = await approved(workspace.personal);
  const updated = await saveCreatorEvaluation(workspace.personal, {
    draftId: request.draftId,
    expectedRevision: request.caseRef.revision,
    cases: [
      {
        id: randomUUID(),
        title: "Citation boundary",
        question: "Cerulean synthetic-forged-citation?",
        criteria: "Reject invented references.",
      },
    ],
  });
  if (!updated.evaluation?.cases[0]) throw new Error("Expected case");
  const item = updated.evaluation.cases[0];
  const preview = await createCreatorPreview(workspace.personal, {
    ...request,
    question: item.question,
    caseRef: { id: item.id, revision: updated.evaluation.revision },
  });
  const server = await runtime(await freePort(), "127.0.0.1", directory);
  const auth = workspaceExecutionFor(workspace.personal).session.auth.current;
  const { sessionId } = z.object({ sessionId: z.string() }).parse(
    await server.request("/probe/send", {
      address: randomUUID(),
      id: randomUUID(),
      message: `preview ${preview.id}`,
      auth,
    })
  );
  await server.settled(sessionId);
  expect(
    await exportCreatorPreview(workspace.personal, preview.id)
  ).toMatchObject({ status: "failed", response: null, groundedAnswer: null });
  await server.stop();
}, 90000);

test("human-qualified grounded pilots use only frozen sources, preserve snapshot mode and reject revoked late answers", async () => {
  await using workspace = await workspaceFixture();
  const { request, release } = await approved(workspace.actor);
  const draft = await readCreatorDraft(workspace.actor, request.draftId);
  const saved = await saveCreatorEvaluation(workspace.actor, {
    draftId: draft.id,
    expectedRevision: draft.evaluation?.revision ?? null,
    cases: [
      {
        id: randomUUID(),
        title: "Supported",
        question: "When is the Cerulean harvest?",
        criteria: "Cite the interval.",
        expectedGrounding: "supported",
      },
      {
        id: randomUUID(),
        title: "Missing evidence",
        question: "Zyxnonexistentcanary?",
        criteria: "Abstain.",
        expectedGrounding: "insufficient-evidence",
      },
    ],
  });
  if (!saved.evaluation) throw new Error("Missing evaluation");
  let server = await runtime(await freePort(), "127.0.0.1", directory);
  const auth = workspaceExecutionFor(workspace.actor).session.auth.current;
  async function start(message: string, principal = auth) {
    const { sessionId } = z.object({ sessionId: z.string() }).parse(
      await server.request("/probe/send", {
        address: randomUUID(),
        id: randomUUID(),
        message,
        auth: principal,
      })
    );
    return { sessionId, events: await server.settled(sessionId) };
  }
  async function respond(
    sessionId: string,
    events: Awaited<ReturnType<typeof server.settled>>,
    response: { optionId?: string; text?: string },
    turn: number,
    principal = auth
  ) {
    const pending = z
      .object({ requests: z.array(inputRequestSchema) })
      .parse(events.findLast((event) => event.type === "input.requested")?.data)
      .requests[0];
    if (!pending) throw new Error("Expected native human question");
    await server.request(`/probe/input/${sessionId}`, {
      auth: principal,
      responses: [{ requestId: pending.requestId, ...response }],
    });
    return server.settled(sessionId, turn);
  }
  try {
    const initial = await readCreatorQualificationCandidate(
      workspace.actor,
      release.id
    );
    expect(initial.issues).toHaveLength(2);
    for (const item of saved.evaluation.cases) {
      const preview = await createCreatorPreview(workspace.actor, {
        ...request,
        id: randomUUID(),
        question: item.question,
        caseRef: { id: item.id, revision: saved.evaluation.revision },
      });
      await start(`preview ${preview.id}`);
      const completed = await exportCreatorPreview(workspace.actor, preview.id);
      expect(completed.groundedAnswer?.status).toBe(item.expectedGrounding);
      const review = await start(`creator-review ${preview.id}`);
      const notes = await respond(
        review.sessionId,
        review.events,
        { optionId: "useful" },
        2
      );
      await respond(
        review.sessionId,
        notes,
        { text: "Human checked the declared source expectation." },
        3
      );
    }
    const candidate = await readCreatorQualificationCandidate(
      workspace.actor,
      release.id
    );
    expect(candidate.issues).toEqual([]);
    await expect(
      approveCreatorQualification(workspace.guest, {
        id: randomUUID(),
        releaseId: release.id,
        manifestDigest: candidate.manifestDigest,
        evaluationRevision: saved.evaluation.revision,
        evidence: candidate.evidence.map((item) => ({
          id: item.id,
          reviewRevision: item.review.revision,
        })),
        notes: "Foreign",
      })
    ).rejects.toThrow("WorkspaceAccessDenied");
    await expect(
      approveCreatorQualification(workspace.actor, {
        id: randomUUID(),
        releaseId: release.id,
        manifestDigest: candidate.manifestDigest,
        evaluationRevision: saved.evaluation.revision,
        evidence: candidate.evidence.map((item) => ({
          id: item.id,
          reviewRevision: randomUUID(),
        })),
        notes: "Stale human review references",
      })
    ).rejects.toThrow("Qualification evidence changed");
    const approval = await start(
      `creator-qualification ${JSON.stringify({ action: "approve", releaseId: release.id })}`
    );
    expect(
      await listCreatorQualifications(workspace.actor, release.id)
    ).toEqual([]);
    await server.stop();
    server = await runtime(await freePort(), "127.0.0.1", directory);
    const approvalNotes = await respond(
      approval.sessionId,
      approval.events,
      { optionId: "approve" },
      2
    );
    await respond(
      approval.sessionId,
      approvalNotes,
      { text: "Private synthetic pilot only; reviewed both outcomes." },
      3
    );
    const [qualified] = await listCreatorQualifications(
      workspace.actor,
      release.id
    );
    if (!qualified) throw new Error("Missing qualified version");
    expect(qualified.cases).toBe(2);
    const username = `pilot_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
    await saveDirectoryProfile(workspace.guest, {
      username,
      discoverable: false,
    });
    const old = await inviteCreatorPilot(workspace.actor, {
      id: randomUUID(),
      releaseId: release.id,
      username,
      shareTeaching: true,
    });
    expect(old.answerMode).toBe("snapshot");
    const invite = await start(
      `creator-pilot ${JSON.stringify({ action: "invite", qualificationId: qualified.id, username })}`
    );
    await respond(invite.sessionId, invite.events, { optionId: "confirm" }, 2);
    const pilot = (await listCreatorPilots(workspace.guest)).find(
      (item) => item.qualificationId === qualified.id
    );
    if (!pilot) throw new Error("Missing grounded invitation");
    expect(pilot.status).toBe("pending");
    await expect(readCreatorPilot(workspace.guest, pilot.id)).rejects.toThrow(
      "WorkspaceAccessDenied"
    );
    const guestAuth = workspaceExecutionFor(workspace.guest).session.auth
      .current;
    const accept = await start(
      `creator-pilot ${JSON.stringify({ action: "accept", id: pilot.id })}`,
      guestAuth
    );
    await respond(
      accept.sessionId,
      accept.events,
      { optionId: "confirm" },
      2,
      guestAuth
    );
    const active = await readCreatorPilot(workspace.guest, pilot.id);
    expect(active.answerMode).toBe("grounded");
    expect((await readCreatorPilot(workspace.actor, old.id)).answerMode).toBe(
      "snapshot"
    );
    const participant = await createCreatorPreview(workspace.guest, {
      id: randomUUID(),
      draftId: draft.id,
      revision: draft.revision,
      kind: "grounded-answer",
      pilotId: pilot.id,
      question: "When is the Cerulean harvest?",
    });
    await start(`preview ${participant.id}`, guestAuth);
    expect(
      (await exportCreatorPreview(workspace.guest, participant.id))
        .groundedAnswer
    ).toMatchObject({ status: "supported", citations: ["S1"] });
    await expect(
      exportCreatorPreview(workspace.actor, participant.id)
    ).rejects.toThrow("WorkspaceAccessDenied");
    const late = await createCreatorPreview(workspace.guest, {
      id: randomUUID(),
      draftId: draft.id,
      revision: draft.revision,
      kind: "grounded-answer",
      pilotId: pilot.id,
      question: "When is the Cerulean harvest?",
    });
    await claimCreatorPreview(workspace.guest, late.id, "late", {
      sessionId: randomUUID(),
      turnId: "late",
    });
    await actOnCreatorPilot(workspace.actor, {
      id: pilot.id,
      action: "withdraw",
    });
    await expect(
      finishCreatorPreview(workspace.guest, late.id, "late", {
        status: "supported",
        answer: "Forty days",
        citations: ["S1"],
      })
    ).rejects.toThrow("WorkspaceAccessDenied");
    const [lateState] = await query<{ status: string }>(
      sql`SELECT status FROM creator_previews WHERE id=${late.id}`
    );
    expect(lateState?.status).toBe("running");
    await saveCreatorEvaluation(workspace.actor, {
      draftId: draft.id,
      expectedRevision: saved.evaluation.revision,
      cases: saved.evaluation.cases.map((item) => ({
        ...item,
        expectedGrounding: "insufficient-evidence" as const,
      })),
    });
    const changed = await readCreatorQualificationCandidate(
      workspace.actor,
      release.id
    );
    expect(changed.issues).toContain(
      "Declare at least one supported case and one insufficient-evidence case before running both."
    );
    await expect(
      approveCreatorQualification(workspace.actor, {
        id: randomUUID(),
        releaseId: release.id,
        manifestDigest: candidate.manifestDigest,
        evaluationRevision: saved.evaluation.revision,
        evidence: candidate.evidence.map((item) => ({
          id: item.id,
          reviewRevision: item.review.revision,
        })),
        notes: "Old declaration",
      })
    ).rejects.toThrow("Declare at least one supported case");
    expect(
      await listCreatorQualifications(workspace.actor, release.id)
    ).toHaveLength(1);
  } finally {
    await server.stop();
  }
}, 180000);
