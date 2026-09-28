import { randomUUID } from "node:crypto";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, test } from "vitest";
import { z } from "zod";
import { freePort } from "../helpers/ports";
import {
  clearFixtureWorkflows,
  compileEveFixture,
  runtime,
} from "./eve-fixture";
import { workspaceExecutionFor, workspaceFixture } from "./workspace-fixture";

const source = (name: string) => `
  import { defineMemory, defineMemoryProvider } from "eve/memory";
  import { defineTool } from "eve/tools";
  import { z } from "zod";
  export default defineMemory({
    scope: () => "synthetic-upgrade-proof",
    provider: defineMemoryProvider({
      recall: { "turn.started": () => ({ messages: [] }) },
      tools: () => ({
        ${name}: defineTool({
          description: "Synthetic compiled memory tool revision.",
          inputSchema: z.object({}),
          execute: () => "synthetic",
        }),
      }),
    }),
  });
`;

beforeAll(clearFixtureWorkflows);
afterAll(clearFixtureWorkflows);

test("a parked compiled session receives new memory tools after rebuilding and restarting", async () => {
  await using workspace = await workspaceFixture();
  const parent = fileURLToPath(new URL("../fixtures/", import.meta.url));
  const directory = await mkdtemp(join(parent, ".eve-memory-upgrade-"));
  try {
    for (const name of ["agent", "package.json", "tsconfig.json"])
      await cp(join(parent, "eve-runtime", name), join(directory, name), {
        recursive: true,
      });
    const memoryPath = join(directory, "agent/memory/upgrade.ts");
    await writeFile(memoryPath, source("before_upgrade"));
    await compileEveFixture(directory);
    const auth = workspaceExecutionFor(workspace.personal).session.auth.current;
    const port = await freePort();
    const server = await runtime(port, "127.0.0.1", directory);
    const { sessionId } = z.object({ sessionId: z.string() }).parse(
      await server.request("/probe/send", {
        address: randomUUID(),
        id: randomUUID(),
        message: "rebind-report-catalog",
        auth,
      })
    );
    const first = await server.settled(sessionId);
    expect(JSON.stringify(first)).toContain("upgrade__before_upgrade");
    expect(JSON.stringify(first)).not.toContain("upgrade__after_upgrade");
    await server.stop();

    // Keep the database and parked session; only the compiled code changes.
    await writeFile(memoryPath, source("after_upgrade"));
    await compileEveFixture(directory);
    const resumed = await runtime(port, "127.0.0.1", directory);
    await resumed.request(`/probe/message/${sessionId}`, {
      message: "rebind-report-catalog",
      auth,
    });
    const completed = await resumed.settled(sessionId, 2);
    const final = z
      .object({ message: z.string() })
      .parse(
        completed.findLast((event) => event.type === "message.completed")?.data
      );
    const tools = z.array(z.string()).parse(JSON.parse(final.message));
    expect(tools).toContain("upgrade__after_upgrade");
    expect(tools).not.toContain("upgrade__before_upgrade");
    await resumed.stop();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 150_000);
