import { randomUUID } from "node:crypto";
import { inputRequestSchema } from "eve/client";
import { z } from "zod";
import { afterAll, beforeAll, expect, test } from "vitest";
import { freePort } from "../helpers/ports";
import { buildEveFixture, clearFixtureWorkflows, runtime } from "./eve-fixture";
import { workspaceExecutionFor, workspaceFixture } from "./workspace-fixture";

beforeAll(buildEveFixture, 65_000);
afterAll(clearFixtureWorkflows);

test("a new restricted reporting turn replaces the previous catalog after restart", async () => {
  await using workspace = await workspaceFixture();
  const principal = workspaceExecutionFor(workspace.personal).session.auth
    .current;
  const auth = {
    ...principal,
    attributes: { ...principal.attributes, memoryProof: "enabled" },
  };
  const port = await freePort();
  const server = await runtime(port);
  const address = randomUUID();
  const sent = await server.request("/probe/send", {
    address,
    id: randomUUID(),
    message: "rebind-report-catalog",
    auth,
  });
  const { sessionId } = z.object({ sessionId: z.string() }).parse(sent);
  const first = await server.settled(sessionId);
  expect(JSON.stringify(first)).toContain("workspace_files_read");
  expect(JSON.stringify(first)).toContain("profile__save_memory");
  expect(JSON.stringify(first)).toContain("workstreams__save");
  await server.stop();

  const resumed = await runtime(port);
  await resumed.request(`/probe/message/${sessionId}`, {
    message: "rebind-report-catalog",
    auth: { ...auth, authenticator: "scheduled-result" },
  });
  const completed = await resumed.settled(sessionId, 2);
  const final = z
    .object({ message: z.string() })
    .parse(
      completed.findLast((event) => event.type === "message.completed")?.data
    );
  const tools = z.array(z.string()).parse(JSON.parse(final.message));
  expect(tools).toContain("send_message");
  expect(tools).not.toContain("react_to_message");
  expect(tools).not.toContain("workspace_files_read");
  expect(tools).not.toContain("workspace-save");
  expect(tools).not.toContain("rebind-approval");
  expect(tools).not.toContain("profile__save_memory");
  expect(tools).not.toContain("workstreams__save");
  expect(completed.filter((event) => event.type === "action.result")).toEqual(
    []
  );
  await resumed.stop();
}, 90_000);

test.each([
  {
    authenticator: "authjs",
    expectedActions: ["completed"],
    expectedContent: "Approved write",
    expectedRevisions: 1,
    expectedRebindFailure: false,
  },
  {
    authenticator: "scheduled-result",
    expectedActions: [],
    expectedContent: null,
    expectedRevisions: 0,
    expectedRebindFailure: true,
  },
] as const)(
  "a parked dynamic approval preserves live authority after restart ($authenticator)",
  async ({
    authenticator,
    expectedActions,
    expectedContent,
    expectedRevisions,
    expectedRebindFailure,
  }) => {
    await using workspace = await workspaceFixture();
    const principal = workspaceExecutionFor(workspace.personal).session.auth
      .current;
    const auth = {
      ...principal,
      attributes: { ...principal.attributes, memoryProof: "enabled" },
    };
    const port = await freePort();
    const server = await runtime(port);
    const address = randomUUID();
    const { sessionId } = z.object({ sessionId: z.string() }).parse(
      await server.request("/probe/send", {
        address,
        id: randomUUID(),
        message: "rebind-approval",
        auth,
      })
    );
    const pending = await server.settled(sessionId);
    const request = z
      .object({ requests: z.array(inputRequestSchema) })
      .parse(pending.find((event) => event.type === "input.requested")?.data)
      .requests[0];
    if (!request) throw new Error("Missing native tool approval.");
    expect(request.kind).toBe("tool-approval");
    await server.stop();
    const resumed = await runtime(port);
    const response = await resumed.request(`/probe/input/${sessionId}`, {
      auth: { ...auth, authenticator },
      responses: [{ requestId: request.requestId, optionId: "approve" }],
    });
    expect(response).toMatchObject({ sessionId, status: "accepted" });
    const eventsSchema = z.array(
      z.object({ type: z.string(), data: z.unknown() })
    );
    let events: z.output<typeof eventsSchema> = [];
    await expect
      .poll(
        async () => {
          events = eventsSchema.parse(
            await resumed.request(`/probe/events/${sessionId}`)
          );
          return (
            events.some((event) => event.type === "session.failed") ||
            events.filter((event) => event.type === "session.waiting").length >=
              2
          );
        },
        { timeout: 30_000, interval: 100 }
      )
      .toBe(true);
    const actions = events
      .filter((event) => event.type === "action.result")
      .map(
        (event) => z.object({ status: z.string() }).parse(event.data).status
      );
    const stored = await workspace.repository.read(
      workspace.personal,
      "knowledge/rebind-approval.md"
    );
    expect(
      actions,
      JSON.stringify(
        events.findLast((event) => event.type === "message.completed")?.data
      )
    ).toEqual(expectedActions);
    expect(stored.content).toBe(expectedContent);
    expect(
      await workspace.repository.history(
        workspace.personal,
        "knowledge/rebind-approval.md"
      )
    ).toHaveLength(expectedRevisions);
    const failure = z
      .object({ message: z.string() })
      .optional()
      .parse(events.find((event) => event.type === "session.failed")?.data);
    expect(
      failure?.message.includes(
        "Dynamic tool callback rebind did not restore"
      ) ?? false
    ).toBe(expectedRebindFailure);
    await resumed.stop();
  },
  90_000
);
