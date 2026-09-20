import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { z } from "zod";
import { freePort } from "../helpers/ports";
import { buildEveFixture, clearFixtureWorkflows, runtime } from "./eve-fixture";
import { workspaceExecutionFor, workspaceFixture } from "./workspace-fixture";

beforeAll(buildEveFixture, 65_000);
afterAll(clearFixtureWorkflows);

test("the compiled production messaging resolver preserves both native callbacks", async () => {
  await using workspace = await workspaceFixture();
  const server = await runtime(await freePort());
  const { sessionId } = z.object({ sessionId: z.string() }).parse(
    await server.request("/probe/send", {
      address: randomUUID(),
      id: randomUUID(),
      message: "message-and-react",
      auth: workspaceExecutionFor(workspace.actor).session.auth.current,
    })
  );
  const events = await server.settled(sessionId);
  const results = z
    .array(
      z.object({
        status: z.literal("completed"),
        result: z.object({ toolName: z.string(), output: z.unknown() }),
      })
    )
    .parse(
      events
        .filter((event) => event.type === "action.result")
        .map((event) => event.data)
    )
    .map((event) => event.result);
  expect(results).toContainEqual({
    toolName: "react_to_message",
    output: { type: "heart", operation: "add" },
  });
  expect(results).toContainEqual({
    toolName: "send_message",
    output: { kind: "message", text: "A real native message." },
  });
  expect(server.output()).not.toContain("non-serializable capture");
  await server.stop();
}, 60_000);
