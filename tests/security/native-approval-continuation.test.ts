import { createHash } from "node:crypto";
import {
  cp,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { z } from "zod";
import type { ApprovalResponsePolicy } from "eve/tools/approval";
import type { SessionAuthContext } from "eve/context";
import type { HarnessToolDefinition } from "../../node_modules/eve/dist/src/harness/execute-tool.js";
import type {
  HandleEventFn,
  HarnessSession,
  StepFn,
  StepInput,
} from "../../node_modules/eve/dist/src/harness/types.js";

const installedRoot = await realpath(
  fileURLToPath(new URL("../../node_modules/eve", import.meta.url))
);
const coordinatorFile = "dist/src/harness/approval-delivery-coordinator.js";
const installedCoordinator = await readFile(
  join(installedRoot, coordinatorFile),
  "utf8"
);
const installedHash = createHash("sha256")
  .update(installedCoordinator)
  .digest("hex");
const temporaryRoot = await mkdtemp(
  join(tmpdir(), "zoen-security-native-approval-")
);
const privateRoot = join(temporaryRoot, "eve");
// Real copied package files keep every #context/#harness import inside one SDK.
// Only external, pinned dependency siblings are reused read-only.
await cp(
  join(installedRoot, "package.json"),
  join(privateRoot, "package.json"),
  { recursive: true }
);
await cp(join(installedRoot, "dist"), join(privateRoot, "dist"), {
  recursive: true,
});
await symlink(dirname(installedRoot), join(privateRoot, "node_modules"), "dir");
const patch = await readFile(
  fileURLToPath(new URL("../../patches/eve@0.63.0.patch", import.meta.url)),
  "utf8"
);
const { before: oldCoordinator, after: patchedCoordinator } =
  coordinatorHunk(patch);
if (
  installedCoordinator !== oldCoordinator &&
  installedCoordinator !== patchedCoordinator
) {
  throw new Error(
    "Installed coordinator does not match either exact maintained patch source."
  );
}
if (installedCoordinator === oldCoordinator)
  await writeFile(join(privateRoot, coordinatorFile), patchedCoordinator);
const sdk = await loadSdk(privateRoot);

function coordinatorHunk(patchText: string) {
  const header = `diff --git a/${coordinatorFile} b/${coordinatorFile}`;
  const sections = patchText.split("\ndiff --git ");
  const section = sections
    .map((part, index) => (index === 0 ? part : `diff --git ${part}`))
    .filter((part) => part.startsWith(`${header}\n`));
  if (section.length !== 1)
    throw new Error("Exactly one maintained coordinator hunk is required.");
  const lines = section[0]?.split("\n") ?? [];
  if (lines.filter((line) => line.startsWith("@@ ")).length !== 1) {
    throw new Error(
      "The coordinator correction must be one exact whole-source hunk."
    );
  }
  const oldIndex = lines.findIndex(
    (line) => line.startsWith("-") && !line.startsWith("--- ")
  );
  const newIndex = lines.findIndex(
    (line) => line.startsWith("+") && !line.startsWith("+++ ")
  );
  if (
    oldIndex < 0 ||
    newIndex <= oldIndex ||
    lines.filter((line) => line.startsWith("-") && !line.startsWith("--- "))
      .length !== 1 ||
    lines.filter((line) => line.startsWith("+") && !line.startsWith("+++ "))
      .length !== 1
  ) {
    throw new Error("Unexpected coordinator patch shape.");
  }
  const source = (index: number) => {
    const line = lines[index];
    if (!line) throw new Error("Missing exact coordinator source.");
    return (
      line.slice(1) +
      (lines[index + 1] === "\\ No newline at end of file" ? "" : "\n")
    );
  };
  return { before: source(oldIndex), after: source(newIndex) };
}

afterAll(async () => {
  const currentHash = createHash("sha256")
    .update(await readFile(join(installedRoot, coordinatorFile)))
    .digest("hex");
  await rm(temporaryRoot, { recursive: true, force: true });
  if (currentHash !== installedHash)
    throw new Error("The installed native SDK was modified during testing.");
});
const now = 1_790_838_900_000;
const requester: SessionAuthContext = {
  authenticator: "native-test",
  issuer: "synthetic",
  principalId: "requester",
  principalType: "user",
  attributes: { workspaceId: "workspace", bindingId: "binding", epoch: "7" },
};
const request = {
  requestId: "exact-request",
  kind: "tool-approval",
  action: {
    kind: "tool-call",
    callId: "exact-call",
    toolName: "exact-action",
    input: { text: "Immutable proposed action" },
  },
  prompt: "Review this exact action",
  options: [
    { id: "approve", label: "Approve" },
    { id: "cancel", label: "Cancel" },
  ],
  allowFreeform: false,
  display: "confirmation",
} satisfies Parameters<
  typeof sdk.batches.appendPendingInputBatch
>[0]["requests"][number];
const approve: StepInput = {
  inputResponses: [{ requestId: request.requestId, optionId: "approve" }],
};

async function loadSdk(root: string) {
  const moduleUrl = (relative: string) =>
    pathToFileURL(join(root, "dist/src", relative)).href;
  return {
    client: await vi.importActual<
      typeof import("../../node_modules/eve/dist/src/client/index.js")
    >(moduleUrl("client/index.js")),
    mock: await vi.importActual<
      typeof import("../../node_modules/eve/dist/src/evals/mock-model.js")
    >(moduleUrl("evals/mock-model.js")),
    coordinator: await vi.importActual<
      typeof import("../../node_modules/eve/dist/src/harness/approval-delivery-coordinator.js")
    >(moduleUrl("harness/approval-delivery-coordinator.js")),
    loop: await vi.importActual<
      typeof import("../../node_modules/eve/dist/src/harness/tool-loop.js")
    >(moduleUrl("harness/tool-loop.js")),
    batches: await vi.importActual<
      typeof import("../../node_modules/eve/dist/src/harness/pending-input-batches.js")
    >(moduleUrl("harness/pending-input-batches.js")),
    candidates: await vi.importActual<
      typeof import("../../node_modules/eve/dist/src/harness/approval-candidates.js")
    >(moduleUrl("harness/approval-candidates.js")),
    context: await vi.importActual<
      typeof import("../../node_modules/eve/dist/src/context/container.js")
    >(moduleUrl("context/container.js")),
    keys: await vi.importActual<
      typeof import("../../node_modules/eve/dist/src/context/keys.js")
    >(moduleUrl("context/keys.js")),
    provider: await vi.importActual<
      typeof import("../../node_modules/eve/dist/src/context/providers/session.js")
    >(moduleUrl("context/providers/session.js")),
  };
}

function fixture(localModel = false) {
  vi.spyOn(Date, "now").mockReturnValue(now);
  const authorizer = vi.fn<ApprovalResponsePolicy>().mockResolvedValue({
    status: "rejected",
    reason: "Current authority was revoked.",
  });
  const action = vi
    .fn<(input: unknown) => Promise<string>>()
    .mockResolvedValue("Executed");
  const events = vi.fn<HandleEventFn>().mockResolvedValue(undefined);
  const model = vi
    .fn<Parameters<typeof sdk.loop.createToolLoopHarness>[0]["resolveModel"]>()
    .mockRejectedValue(
      new Error("A model/provider call is outside this scheduling test.")
    );
  if (localModel)
    model.mockResolvedValue(sdk.mock.mockModel("Synthetic action finished."));
  const prepare = vi
    .fn<
      NonNullable<
        Parameters<
          typeof sdk.loop.createToolLoopHarness
        >[0]["resolveStepDynamicTools"]
      >
    >()
    .mockResolvedValue(undefined);
  const tool = {
    name: "exact-action",
    description: "Synthetic action",
    inputSchema: z.strictObject({ text: z.string() }),
    approval: { request: () => "user-approval", response: authorizer },
    execute: action,
  } satisfies HarnessToolDefinition;
  const initial = sdk.batches.appendPendingInputBatch({
    session: {
      agent: {
        system: "",
        tools: [],
        modelReference: { id: "synthetic/model" },
      },
      compaction: { recentWindowSize: 1, threshold: 1000 },
      continuationToken: "no-workflow",
      history: [],
      sessionId: "exact-session",
    },
    requests: [request],
    responseAuthRequiredRequestIds: [request.requestId],
    event: { sequence: 0, stepIndex: 0, turnId: "turn_0" },
    responseMessages: [
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: request.action.callId,
            toolName: request.action.toolName,
            input: request.action.input,
          },
          {
            type: "tool-approval-request",
            approvalId: request.requestId,
            toolCallId: request.action.callId,
          },
        ],
      },
    ],
  });
  const tools = new Map([[tool.name, tool]]);
  const createStep = () =>
    sdk.loop.createToolLoopHarness({
      mode: "conversation",
      tools,
      handleEvent: events,
      resolveModel: model,
      resolveStepDynamicTools: prepare,
    });
  const step = createStep();
  async function scoped<T>(
    session: HarnessSession,
    auth: SessionAuthContext | null,
    run: () => Promise<T>
  ) {
    const context = new sdk.context.ContextContainer();
    context.set(sdk.keys.AuthKey, auth);
    context.set(sdk.keys.InitiatorAuthKey, requester);
    context.set(sdk.keys.SessionIdKey, session.sessionId);
    context.set(sdk.keys.ModeKey, "conversation");
    const provided = await sdk.provider.sessionProvider.create(
      context,
      session
    );
    if (!provided) throw new Error("Native session context must be available.");
    context.setVirtualContext(sdk.keys.SessionKey, provided.value);
    return sdk.context.contextStorage.run(context, run);
  }
  async function managed(
    run: StepFn,
    session: HarnessSession,
    input?: StepInput,
    auth: SessionAuthContext | null = requester
  ) {
    return scoped(session, auth, () => run(session, input));
  }
  async function coordinate(
    session: HarnessSession,
    input?: StepInput,
    timestamp = now,
    auth: SessionAuthContext | null = requester
  ) {
    return scoped(session, auth, () =>
      sdk.coordinator.coordinateApprovalDelivery({
        session,
        stepInput: input,
        now: timestamp,
        tools,
      })
    );
  }
  return {
    initial,
    step,
    createStep,
    tools,
    managed,
    coordinate,
    authorizer,
    action,
    events,
    model,
    prepare,
  };
}

function continuation(result: Awaited<ReturnType<StepFn>>) {
  expect(result.next).toBeTypeOf("function");
  if (typeof result.next !== "function")
    throw new Error("Native approval coordination must continue.");
  return result.next;
}

const forbiddenFetch = vi
  .fn<typeof fetch>()
  .mockRejectedValue(
    new Error(
      "External network access is forbidden in native scheduling tests."
    )
  );
beforeEach(() => {
  forbiddenFetch.mockClear();
  vi.stubGlobal("fetch", forbiddenFetch);
});
afterEach(() => {
  const forbiddenCalls = forbiddenFetch.mock.calls.length;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (forbiddenCalls > 0)
    throw new Error(
      "A native scheduling test attempted external network access."
    );
});

describe("native conversation approval continuation", () => {
  it("continues an unchanged duplicate before authorizing the stored candidate", async () => {
    const f = fixture();
    const first = await f.managed(f.step, f.initial, approve);
    const before = sdk.candidates.getApprovalAuditState(first.session.state);
    expect(before.activeCandidates).toHaveLength(1);
    expect(f.authorizer).not.toHaveBeenCalled();
    const duplicate = await f.managed(
      continuation(first),
      first.session,
      approve
    );
    expect(
      sdk.candidates.getApprovalAuditState(duplicate.session.state)
    ).toEqual(before);
    expect(f.authorizer).not.toHaveBeenCalled();
    expect(f.action).not.toHaveBeenCalled();
    expect(f.model).not.toHaveBeenCalled();
    continuation(duplicate);
  });

  it("prepares the current native policy after duplicate ingestion and preserves the exact request", async () => {
    const f = fixture();
    const first = await f.managed(f.step, f.initial, approve);
    const duplicate = await f.managed(
      continuation(first),
      first.session,
      approve
    );
    const reviewed = await f.managed(
      continuation(duplicate),
      duplicate.session
    );
    expect(f.prepare).toHaveBeenCalledTimes(3);
    expect(f.authorizer).toHaveBeenCalledTimes(1);
    const context = f.authorizer.mock.calls[0]?.[0];
    expect(context?.request).toEqual({
      callId: "exact-call",
      requestId: "exact-request",
      toolInput: request.action.input,
      toolName: "exact-action",
    });
    expect(context?.responder).toEqual(requester);
    expect(context?.session).toMatchObject({
      id: "exact-session",
      initiator: requester,
    });
    const audit = sdk.candidates.getApprovalAuditState(reviewed.session.state);
    expect(audit.activeCandidates).toHaveLength(0);
    expect(audit.candidateHistory).toMatchObject([
      { status: "rejected", requestId: request.requestId },
    ]);
    expect(audit.settlements).toHaveLength(0);
    expect(f.action).not.toHaveBeenCalled();
    expect(f.model).not.toHaveBeenCalled();
  });

  it("does not refresh candidate TTL or replace stored scoped attribution on duplicate", async () => {
    const f = fixture();
    const first = await f.managed(f.step, f.initial, approve);
    const before = sdk.candidates.getApprovalAuditState(first.session.state);
    vi.spyOn(Date, "now").mockReturnValue(now + 20_000);
    const replacement = {
      ...requester,
      attributes: {
        ...requester.attributes,
        epoch: "999",
        bindingId: "other-binding",
      },
    };
    const duplicate = await f.managed(
      continuation(first),
      first.session,
      approve,
      replacement
    );
    expect(
      sdk.candidates.getApprovalAuditState(duplicate.session.state)
    ).toEqual(before);
    continuation(duplicate);
    expect(f.authorizer).not.toHaveBeenCalled();
    expect(f.action).not.toHaveBeenCalled();
  });

  it("feeds the genuine public client Session.respond plain envelope into managed conversation coordination", async () => {
    const f = fixture();
    const captured: StepInput[] = [];
    const transport = vi
      .fn<typeof fetch>()
      .mockImplementation(async (url, init) => {
        const address =
          url instanceof Request
            ? url.url
            : url instanceof URL
              ? url.href
              : url;
        expect(address).toBe(
          "https://synthetic.invalid/eve/v1/session/exact-session"
        );
        expect(init?.method).toBe("POST");
        if (typeof init?.body !== "string")
          throw new Error("The public response must have an exact JSON body.");
        const raw: unknown = JSON.parse(init.body);
        const envelope = z
          .strictObject({
            inputResponses: z.array(
              z.strictObject({ requestId: z.string(), optionId: z.string() })
            ),
          })
          .parse(raw);
        captured.push(envelope);
        return Response.json({ sessionId: "exact-session" });
      });
    vi.stubGlobal("fetch", transport);
    const client = new sdk.client.Client({ host: "https://synthetic.invalid" });
    const session = client.sessions.attach("exact-session");
    await session.respond([
      { requestId: request.requestId, optionId: "approve" },
    ]);
    await session.respond([
      { requestId: request.requestId, optionId: "approve" },
    ]);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(captured).toEqual([approve, approve]);
    const first = await f.managed(f.step, f.initial, captured[0]);
    const duplicate = await f.managed(
      continuation(first),
      first.session,
      captured[1]
    );
    const reviewed = await f.managed(
      continuation(duplicate),
      duplicate.session
    );
    expect(f.authorizer).toHaveBeenCalledTimes(1);
    expect(
      sdk.candidates.getApprovalAuditState(reviewed.session.state).settlements
    ).toHaveLength(0);
    expect(f.action).not.toHaveBeenCalled();
  });

  it("keeps repeated duplicates in the ingestion phase without creating additional candidates", async () => {
    const f = fixture();
    let current = await f.managed(f.step, f.initial, approve);
    const candidate = sdk.candidates.getApprovalAuditState(
      current.session.state
    );
    for (let attempt = 0; attempt < 4; attempt += 1) {
      current = await f.managed(
        continuation(current),
        current.session,
        approve
      );
      expect(
        sdk.candidates.getApprovalAuditState(current.session.state)
      ).toEqual(candidate);
      expect(f.authorizer).not.toHaveBeenCalled();
      continuation(current);
    }
    const reviewed = await f.managed(continuation(current), current.session);
    expect(f.authorizer).toHaveBeenCalledTimes(1);
    expect(
      sdk.candidates.getApprovalAuditState(reviewed.session.state).settlements
    ).toHaveLength(0);
    expect(f.action).not.toHaveBeenCalled();
  });

  it("settles the original allowed call and executes its exact payload once through native tool replay", async () => {
    const f = fixture(true);
    f.authorizer.mockResolvedValue({ status: "allowed" });
    const first = await f.managed(f.step, f.initial, approve);
    const original = sdk.candidates.getApprovalAuditState(first.session.state)
      .activeCandidates[0];
    const duplicate = await f.managed(
      continuation(first),
      first.session,
      approve
    );
    expect(f.action).not.toHaveBeenCalled();
    const resolved = await f.managed(
      continuation(duplicate),
      duplicate.session
    );
    const audit = sdk.candidates.getApprovalAuditState(resolved.session.state);
    expect(audit.settlements).toMatchObject([
      {
        outcome: "allowed",
        requestId: request.requestId,
        candidateId: original?.candidateId,
      },
    ]);
    expect(audit.candidateHistory).toMatchObject([
      { status: "allowed", candidateId: original?.candidateId },
    ]);
    expect(audit.activeCandidates).toHaveLength(0);
    expect(f.authorizer).toHaveBeenCalledTimes(1);
    expect(f.action).toHaveBeenCalledTimes(1);
    expect(f.action.mock.calls[0]?.[0]).toEqual(request.action.input);
    expect(
      f.events.mock.calls.filter(([event]) => event.type === "approval.settled")
    ).toHaveLength(1);
    expect(
      f.events.mock.calls.filter(([event]) => event.type === "input.resolved")
    ).toHaveLength(1);
    const modelCount = f.model.mock.calls.length;
    const replay = await f.managed(f.step, resolved.session, approve);
    expect(replay.next).toBeNull();
    expect(sdk.candidates.getApprovalAuditState(replay.session.state)).toEqual(
      audit
    );
    expect(f.authorizer).toHaveBeenCalledTimes(1);
    expect(f.action).toHaveBeenCalledTimes(1);
    // The native stale-response layer intentionally converts a settled reply to
    // a user message. It may generate text, but cannot execute the settled call.
    expect(f.model).toHaveBeenCalledTimes(modelCount + 1);
    expect(
      f.events.mock.calls.filter(([event]) => event.type === "input.resolved")
    ).toHaveLength(1);
    const nativeReplay = await f.coordinate(resolved.session, approve);
    expect(nativeReplay.kind).toBe("park");
    expect(
      sdk.candidates.getApprovalAuditState(nativeReplay.session.state)
    ).toEqual(audit);
  });

  it.each(["after-first-response", "after-duplicate"])(
    "cancels %s before authorizer continuation and never resurrects the candidate on approval replay",
    async (stage) => {
      const f = fixture(true);
      f.authorizer.mockResolvedValue({ status: "allowed" });
      const first = await f.managed(f.step, f.initial, approve);
      const pending =
        stage === "after-duplicate"
          ? await f.managed(continuation(first), first.session, approve)
          : first;
      const cancelled = await f.managed(
        continuation(pending),
        pending.session,
        {
          inputResponses: [
            { requestId: request.requestId, optionId: "cancel" },
          ],
        }
      );
      expect(f.authorizer).not.toHaveBeenCalled();
      const resolved = await f.managed(
        continuation(cancelled),
        cancelled.session
      );
      const audit = sdk.candidates.getApprovalAuditState(
        resolved.session.state
      );
      expect(audit.settlements).toMatchObject([
        { outcome: "cancelled", requestId: request.requestId },
      ]);
      expect(audit.candidateHistory).toMatchObject([
        { status: "stale", requestId: request.requestId },
      ]);
      expect(audit.activeCandidates).toHaveLength(0);
      expect(f.action).not.toHaveBeenCalled();
      const replay = await f.managed(f.step, resolved.session, approve);
      expect(replay.next).toBeNull();
      expect(
        sdk.candidates.getApprovalAuditState(replay.session.state)
      ).toEqual(audit);
      expect(f.authorizer).not.toHaveBeenCalled();
      expect(f.action).not.toHaveBeenCalled();
      expect(
        f.events.mock.calls.filter(([event]) => event.type === "input.resolved")
      ).toHaveLength(1);
    }
  );

  it("reviews current authority after ingestion rather than treating the duplicate as permission", async () => {
    const f = fixture();
    let member = true;
    f.authorizer.mockImplementation(() =>
      member
        ? { status: "allowed" }
        : { status: "rejected", reason: "Membership revoked." }
    );
    const first = await f.managed(f.step, f.initial, approve);
    const duplicate = await f.managed(
      continuation(first),
      first.session,
      approve
    );
    member = false;
    const reviewed = await f.managed(
      continuation(duplicate),
      duplicate.session
    );
    expect(f.authorizer).toHaveBeenCalledTimes(1);
    expect(
      sdk.candidates.getApprovalAuditState(reviewed.session.state)
        .candidateHistory
    ).toMatchObject([{ status: "rejected", reason: "Membership revoked." }]);
    expect(
      sdk.candidates.getApprovalAuditState(reviewed.session.state).settlements
    ).toHaveLength(0);
    expect(f.action).not.toHaveBeenCalled();
    expect(f.model).not.toHaveBeenCalled();
  });

  it("keeps a nonrequester candidate bound to its responder and lets the actual response policy reject it", async () => {
    const f = fixture();
    const other = { ...requester, principalId: "different-member" };
    f.authorizer.mockImplementation(({ responder, session }) =>
      responder.principalId === session.initiator?.principalId
        ? { status: "allowed" }
        : {
            status: "rejected",
            reason: "Only the original requester may approve.",
          }
    );
    const first = await f.managed(f.step, f.initial, approve, other);
    const duplicate = await f.managed(
      continuation(first),
      first.session,
      approve,
      other
    );
    const reviewed = await f.managed(
      continuation(duplicate),
      duplicate.session,
      undefined,
      other
    );
    expect(f.authorizer.mock.calls[0]?.[0].responder).toEqual(other);
    expect(f.authorizer.mock.calls[0]?.[0].session.initiator).toEqual(
      requester
    );
    expect(
      sdk.candidates.getApprovalAuditState(reviewed.session.state)
        .candidateHistory
    ).toMatchObject([
      { status: "rejected", responder: { principalId: "different-member" } },
    ]);
    expect(
      sdk.candidates.getApprovalAuditState(reviewed.session.state).settlements
    ).toHaveLength(0);
    expect(f.action).not.toHaveBeenCalled();
  });

  it("leaves installed source and every preexisting patch correction unchanged", async () => {
    expect(
      createHash("sha256")
        .update(await readFile(join(installedRoot, coordinatorFile)))
        .digest("hex")
    ).toBe(installedHash);
    expect(await readFile(join(privateRoot, coordinatorFile), "utf8")).toBe(
      patchedCoordinator
    );
    for (const relative of [
      "dist/src/compiled/@workflow/core/runtime.js",
      "dist/src/context/memory-tools.js",
      "dist/src/execution/session/turn-step.js",
      "dist/src/harness/emission.d.ts",
      "dist/src/harness/emission.js",
      "dist/src/harness/tool-loop.js",
    ]) {
      expect(await readFile(join(privateRoot, relative), "utf8")).toBe(
        await readFile(join(installedRoot, relative), "utf8")
      );
    }
  });

  it("rejects stale request responses without creating a candidate or executing the current pending action", async () => {
    const f = fixture(true);
    const stale = await f.managed(f.step, f.initial, {
      inputResponses: [
        { requestId: "superseded-request", optionId: "approve" },
      ],
    });
    expect(stale.next).toBeNull();
    expect(
      sdk.candidates.getApprovalAuditState(stale.session.state).activeCandidates
    ).toHaveLength(0);
    expect(
      sdk.batches
        .getPendingInputBatches(stale.session.state)
        .flatMap((batch) => batch.requests)
    ).toEqual([request]);
    expect(f.authorizer).not.toHaveBeenCalled();
    expect(f.action).not.toHaveBeenCalled();
    // Native stale-input feedback may generate text without resolving consent.
    expect(f.model).toHaveBeenCalledTimes(1);
  });

  it("preserves unauthenticated response feedback without creating permission", async () => {
    const f = fixture();
    const response = await f.managed(f.step, f.initial, approve, null);
    expect(response.next).toBeNull();
    expect(
      sdk.candidates.getApprovalAuditState(response.session.state)
        .activeCandidates
    ).toHaveLength(0);
    expect(
      f.events.mock.calls.some(
        ([event]) =>
          event.type === "message.completed" &&
          event.data.message ===
            "Authentication is required to respond to this approval."
      )
    ).toBe(true);
    expect(f.authorizer).not.toHaveBeenCalled();
    expect(f.action).not.toHaveBeenCalled();
  });

  it("does not resurrect an expired candidate when a consumed response cannot create a new one", async () => {
    const f = fixture();
    const first = await f.managed(f.step, f.initial, approve);
    const original = sdk.candidates.getApprovalAuditState(first.session.state)
      .activeCandidates[0];
    if (!original) throw new Error("The native candidate must exist.");
    const expired = await f.coordinate(
      first.session,
      approve,
      original.expiresAt,
      null
    );
    expect(expired.kind).toBe("continue");
    expect(expired.feedback).toEqual([
      "Authentication is required to respond to this approval.",
    ]);
    const audit = sdk.candidates.getApprovalAuditState(expired.session.state);
    expect(audit.activeCandidates).toHaveLength(0);
    expect(audit.candidateHistory).toMatchObject([
      { candidateId: original.candidateId, status: "timed-out" },
    ]);
    expect(audit.settlements).toHaveLength(0);
    expect(f.authorizer).not.toHaveBeenCalled();
    expect(f.action).not.toHaveBeenCalled();
  });

  it("allows a fresh authenticated candidate after expiry without refreshing or reviving the old candidate", async () => {
    const f = fixture();
    const first = await f.managed(f.step, f.initial, approve);
    const original = sdk.candidates.getApprovalAuditState(first.session.state)
      .activeCandidates[0];
    if (!original) throw new Error("The native candidate must exist.");
    const fresh = await f.coordinate(
      first.session,
      approve,
      original.expiresAt
    );
    expect(fresh.kind).toBe("continue-coordination");
    const audit = sdk.candidates.getApprovalAuditState(fresh.session.state);
    expect(audit.candidateHistory).toMatchObject([
      { candidateId: original.candidateId, status: "timed-out" },
    ]);
    expect(audit.activeCandidates).toHaveLength(1);
    expect(audit.activeCandidates[0]?.candidateId).not.toBe(
      original.candidateId
    );
    expect(audit.activeCandidates[0]?.createdAt).toBe(original.expiresAt);
    expect(audit.activeCandidates[0]?.expiresAt).toBe(
      original.expiresAt + 600_000
    );
    expect(f.authorizer).not.toHaveBeenCalled();
  });

  it("does not continue an unrelated active candidate merely because another request response was consumed", async () => {
    const f = fixture();
    const other = {
      ...request,
      requestId: "unrelated-request",
      action: { ...request.action, callId: "unrelated-call" },
    };
    const pending = sdk.batches.appendPendingInputBatch({
      session: f.initial,
      requests: [other],
      responseAuthRequiredRequestIds: [other.requestId],
      responseMessages: [],
    });
    const created = sdk.candidates.createApprovalCandidate({
      candidateIdPrefix: "unrelated-candidate",
      createdAt: now,
      expiresAt: now + 600_000,
      requestId: other.requestId,
      responder: requester,
      state: pending.state,
    });
    const session = { ...pending, state: created.state };
    const result = await f.coordinate(session, approve, now, null);
    expect(result.kind).toBe("continue");
    expect(sdk.candidates.getApprovalAuditState(result.session.state)).toEqual(
      sdk.candidates.getApprovalAuditState(session.state)
    );
    expect(result.feedback).toEqual([
      "Authentication is required to respond to this approval.",
    ]);
    expect(f.authorizer).not.toHaveBeenCalled();
  });

  it("does not use an orphan candidate as a reason to coordinate a different live request", async () => {
    const f = fixture();
    const created = sdk.candidates.createApprovalCandidate({
      candidateIdPrefix: "orphan-candidate",
      createdAt: now,
      expiresAt: now + 600_000,
      requestId: "removed-request",
      responder: requester,
      state: f.initial.state,
    });
    const session = { ...f.initial, state: created.state };
    const result = await f.coordinate(session, approve, now, null);
    expect(result.kind).toBe("continue");
    expect(sdk.candidates.getApprovalAuditState(result.session.state)).toEqual(
      sdk.candidates.getApprovalAuditState(session.state)
    );
    expect(result.feedback).toEqual([
      "Authentication is required to respond to this approval.",
    ]);
    expect(f.authorizer).not.toHaveBeenCalled();
  });

  it.each(["after-first-response", "after-duplicate"])(
    "recovers the JSON-equivalent native candidate snapshot %s with a fresh harness",
    async (stage) => {
      const f = fixture(true);
      f.authorizer.mockResolvedValue({ status: "allowed" });
      const first = await f.managed(f.step, f.initial, approve);
      const pending =
        stage === "after-duplicate"
          ? await f.managed(continuation(first), first.session, approve)
          : first;
      const audit = sdk.candidates.getApprovalAuditState(pending.session.state);
      const restored = structuredClone(pending.session);
      const decoded: unknown = JSON.parse(JSON.stringify(pending.session));
      expect(decoded).toEqual(restored);
      const resumed = await f.managed(f.createStep(), restored, approve);
      expect(
        sdk.candidates.getApprovalAuditState(resumed.session.state)
      ).toEqual(audit);
      expect(f.authorizer).not.toHaveBeenCalled();
      const resolved = await f.managed(continuation(resumed), resumed.session);
      expect(
        sdk.candidates.getApprovalAuditState(resolved.session.state).settlements
      ).toMatchObject([
        {
          requestId: request.requestId,
          outcome: "allowed",
          candidateId: audit.activeCandidates[0]?.candidateId,
        },
      ]);
      expect(f.authorizer).toHaveBeenCalledTimes(1);
      expect(f.authorizer.mock.calls[0]?.[0].responder).toEqual(requester);
      expect(f.action).toHaveBeenCalledTimes(1);
      expect(f.action.mock.calls[0]?.[0]).toEqual(request.action.input);
      expect(
        f.events.mock.calls.filter(([event]) => event.type === "input.resolved")
      ).toHaveLength(1);
    }
  );

  it("keeps an unfinished native authorization challenge pending after one duplicate continuation", async () => {
    const f = fixture();
    const first = await f.managed(f.step, f.initial, approve);
    const candidate = sdk.candidates.getApprovalAuditState(first.session.state)
      .activeCandidates[0];
    if (!candidate) throw new Error("The native candidate must exist.");
    const challenge = {
      name: "synthetic-auth",
      candidateId: candidate.candidateId,
      challenge: {
        instructions: "Complete native authorization.",
        expiresAt: new Date(now + 120_000).toISOString(),
      },
      hookUrl: "https://synthetic.invalid/authorization",
    };
    const session = {
      ...first.session,
      state: sdk.candidates.markApprovalCandidateAuthorizationRequired({
        candidateId: candidate.candidateId,
        state: first.session.state,
        authorizationChallenges: [challenge],
        expiresAt: now + 120_000,
      }),
    };
    const duplicate = await f.managed(continuation(first), session, approve);
    const waiting = await f.managed(continuation(duplicate), duplicate.session);
    expect(waiting.next).toBeNull();
    const audit = sdk.candidates.getApprovalAuditState(waiting.session.state);
    expect(audit.activeCandidates).toMatchObject([
      {
        candidateId: candidate.candidateId,
        status: "authorization-required",
        authorizationChallenges: [challenge],
        expiresAt: now + 120_000,
      },
    ]);
    expect(audit.settlements).toHaveLength(0);
    expect(f.authorizer).not.toHaveBeenCalled();
    expect(f.action).not.toHaveBeenCalled();
    expect(f.model).not.toHaveBeenCalled();
    const again = await f.managed(f.step, waiting.session, approve);
    const parked = await f.managed(continuation(again), again.session);
    expect(parked.next).toBeNull();
    expect(f.authorizer).not.toHaveBeenCalled();
    expect(
      f.events.mock.calls.filter(
        ([event]) => event.type === "authorization.required"
      )
    ).toHaveLength(1);
  });
});
