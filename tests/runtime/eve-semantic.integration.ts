import { randomUUID } from "node:crypto";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { z } from "zod";
import { SemanticQueryResultSchema } from "@zoen/companion-ui/semantic-query";
import { compileEveFixture, runtime } from "./eve-fixture";
import { freePort } from "../helpers/ports";
import { workspaceExecutionFor, workspaceFixture } from "./workspace-fixture";

let directory: string;
beforeAll(async () => {
  const fixtures = fileURLToPath(new URL("../fixtures/", import.meta.url));
  directory = await mkdtemp(join(fixtures, ".eve-semantic-"));
  for (const file of ["agent", "package.json", "tsconfig.json"])
    await cp(join(fixtures, "eve-runtime", file), join(directory, file), {
      recursive: true,
    });
  await compileEveFixture(directory);
  await cp(
    new URL("../../.output/server/semantic/", import.meta.url),
    join(directory, ".output/server/semantic"),
    { recursive: true }
  );
}, 90000);
afterAll(async () => {
  // Only this test's temporary application is removed; no database reset.
  if (directory) await rm(directory, { recursive: true, force: true });
});

test("compiled Eve retains the exact governed calculation and manifest after restart without rerunning it", async () => {
  await using workspace = await workspaceFixture();
  const path = "knowledge/queries/total.json";
  const published = await workspace.repository.publish(workspace.actor, {
    operationId: randomUUID(),
    expectedRevision: null,
    changes: [
      { path: "knowledge/data/items.csv", content: "amount\n10\n20\n" },
      {
        path: "knowledge/models/items.malloy",
        content:
          "source: items is snapshot.table('public.items')\nquery: total is items -> { aggregate: total is amount.sum() }",
      },
      {
        path,
        content: JSON.stringify({
          version: 1,
          model: "knowledge/models/items.malloy",
          query: "total",
          parameters: {},
          sources: [
            {
              name: "items",
              path: "knowledge/data/items.csv",
              columns: [{ name: "amount", type: "numeric" }],
            },
          ],
        }),
      },
    ],
  });
  const auth = workspaceExecutionFor(workspace.guest).session.auth.current;
  const input = {
    address: randomUUID(),
    id: randomUUID(),
    auth,
    message: `knowledge-query ${JSON.stringify({ path, revision: published.revision, arguments: {} })}`,
  };
  const port = await freePort();
  let server = await runtime(port, "127.0.0.1", directory);
  try {
    const { sessionId } = z
      .object({ sessionId: z.string() })
      .parse(await server.request("/probe/send", input));
    const events = await server.settled(sessionId);
    const action = events.findLast((event) => event.type === "action.result");
    const data = z
      .object({
        status: z.literal("completed"),
        result: z.object({ output: SemanticQueryResultSchema }),
      })
      .parse(action?.data);
    expect(data.result.output.rows).toEqual([{ total: 30 }]);
    expect(data.result.output.manifest).toMatchObject({
      actor: workspace.guest.userId,
      workspaceId: workspace.actor.workspaceId,
      revision: published.revision,
      query: path,
    });
    const evidence = process.env.ZOEN_SEMANTIC_QA_EVIDENCE;
    if (evidence)
      await writeFile(
        evidence,
        JSON.stringify({ output: data.result.output, events })
      );
    const original = events.filter((event) => event.type === "action.result");
    await server.stop();
    server = await runtime(port, "127.0.0.1", directory);
    expect(await server.request("/probe/send", input)).toEqual({ sessionId });
    const replay = await server.settled(sessionId);
    expect(replay.filter((event) => event.type === "action.result")).toEqual(
      original
    );
    await server.request(`/probe/message/${sessionId}`, {
      auth,
      message: "knowledge-query-history",
    });
    const continued = await server.settled(sessionId, 2);
    expect(continued.filter((event) => event.type === "action.result")).toEqual(
      original
    );
    const message = z
      .object({ message: z.string() })
      .parse(
        continued.findLast((event) => event.type === "message.completed")?.data
      );
    const recalled = z
      .object({
        toolResults: z.array(
          z.object({
            name: z.literal("workspace_knowledge_query"),
            output: SemanticQueryResultSchema,
          })
        ),
      })
      .parse(JSON.parse(message.message));
    expect(recalled.toolResults).toEqual([
      { name: "workspace_knowledge_query", output: data.result.output },
    ]);
  } finally {
    await server.stop();
  }
}, 90000);

test("cancelling real governed calculations releases both executor slots and cannot produce late answers", async () => {
  await using workspace = await workspaceFixture();
  const path = "knowledge/queries/slow.json";
  const definition = {
    version: 1,
    model: "knowledge/models/items.malloy",
    query: "slow",
    parameters: {},
    sources: [
      {
        name: "items",
        path: "knowledge/data/items.csv",
        columns: [{ name: "amount", type: "numeric" }],
      },
    ],
  };
  const published = await workspace.repository.publish(workspace.actor, {
    operationId: randomUUID(),
    expectedRevision: null,
    changes: [
      { path: "knowledge/data/items.csv", content: "amount\n10\n20\n" },
      {
        path: "knowledge/models/items.malloy",
        content:
          "##! experimental.sql_functions\nsource: items is snapshot.table('public.items')\nquery: slow is items -> { select: delay is sql_number('COALESCE((SELECT 1 FROM pg_sleep(30)),0)') }\nquery: total is items -> { aggregate: total is amount.sum() }",
      },
      { path, content: JSON.stringify(definition) },
      {
        path: "knowledge/queries/total.json",
        content: JSON.stringify({ ...definition, query: "total" }),
      },
    ],
  });
  const auth = workspaceExecutionFor(workspace.guest).session.auth.current;
  const server = await runtime(await freePort(), "127.0.0.1", directory);
  const command = (query: string) => ({
    address: randomUUID(),
    id: randomUUID(),
    auth,
    message: `knowledge-query ${JSON.stringify({ path: query, revision: published.revision, arguments: {} })}`,
  });
  try {
    const sessions = await Promise.all(
      [1, 2].map(
        async () =>
          z
            .object({ sessionId: z.string() })
            .parse(await server.request("/probe/start", command(path)))
            .sessionId
      )
    );
    await expect
      .poll(
        async () => {
          const events = await Promise.all(
            sessions.map((id) => server.request(`/probe/events/${id}`))
          );
          return events.every((value) =>
            JSON.stringify(value).includes('"actions.requested"')
          );
        },
        { timeout: 10000, interval: 100 }
      )
      .toBe(true);
    // Confirm cancellation is requested before either invocation settles. The
    // subprocess test independently observes SIGKILL and capacity release.
    await delay(1500);
    for (const id of sessions) {
      expect(
        JSON.stringify(await server.request(`/probe/events/${id}`))
      ).not.toContain('"action.result"');
    }
    const started = performance.now();
    const cancellations = await Promise.all(
      sessions.map((id) => server.request(`/probe/cancel/${id}`, {}))
    );
    expect(cancellations).toEqual(
      sessions.map((sessionId) => ({ sessionId, status: "accepted" }))
    );
    for (const id of sessions) {
      await expect
        .poll(
          async () =>
            JSON.stringify(await server.request(`/probe/events/${id}`)),
          { timeout: 5000, interval: 100 }
        )
        .toContain('"turn.cancelled"');
    }
    const { sessionId } = z
      .object({ sessionId: z.string() })
      .parse(
        await server.request(
          "/probe/start",
          command("knowledge/queries/total.json")
        )
      );
    const completed = await server.settled(sessionId);
    const result = z
      .object({
        status: z.literal("completed"),
        result: z.object({ output: SemanticQueryResultSchema }),
      })
      .parse(
        completed.findLast((event) => event.type === "action.result")?.data
      );
    expect(result.result.output.rows).toEqual([{ total: 30 }]);
    expect(performance.now() - started).toBeLessThan(8000);
    for (const id of sessions) {
      const events = z
        .array(z.object({ type: z.string(), data: z.unknown() }))
        .parse(await server.request(`/probe/events/${id}`));
      expect(
        events
          .filter((event) => event.type === "action.result")
          .some((event) =>
            JSON.stringify(event.data).includes('"status":"completed"')
          )
      ).toBe(false);
    }
  } finally {
    await server.stop();
  }
}, 60000);
