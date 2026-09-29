import { randomUUID } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { inputRequestSchema } from "eve/client";
import { afterAll, beforeAll, expect, test } from "vitest";
import { z } from "zod";
import { freePort } from "../helpers/ports";
import {
  clearFixtureWorkflows,
  compileEveFixture,
  runtime,
} from "./eve-fixture";
import { workspaceExecutionFor, workspaceFixture } from "./workspace-fixture";

let directory: string;
beforeAll(async () => {
  await clearFixtureWorkflows();
  const fixtures = fileURLToPath(new URL("../fixtures/", import.meta.url));
  directory = await mkdtemp(join(fixtures, ".eve-memory-media-"));
  for (const name of ["agent", "package.json", "tsconfig.json"])
    await cp(join(fixtures, "eve-runtime", name), join(directory, name), {
      recursive: true,
    });
  const channel = join(directory, "agent/channels/probe.ts");
  await writeFile(
    channel,
    (await readFile(channel, "utf8"))
      .replaceAll(
        "message: z.string()",
        'message: z.union([z.string(), z.array(z.union([z.object({type: z.literal("text"), text: z.string()}), z.object({type: z.literal("file"), data: z.string(), filename: z.string(), mediaType: z.string()})]))])'
      )
      .replaceAll("input.message,", "mediaInput(input.message),") +
      `
      function mediaInput(input) {
        if (typeof input === "string") return input;
        return input.map(part => {
          if (part.type !== "file" || part.filename === "source-url.md") return part;
          const bytes = Buffer.from(part.data.slice(part.data.indexOf(",") + 1), "base64");
          const framed = Buffer.concat([Buffer.from("prefix"), bytes, Buffer.from("suffix")]);
          return {...part, data: part.filename === "source-bytes.md"
            ? framed.subarray(6, 6 + bytes.length)
            : Uint8Array.from(bytes).buffer};
        });
      }
    `
  );
  await writeFile(
    join(directory, "agent/agent.ts"),
    `
    import { defineAgent, defineDynamic } from "eve";
    import { mockModel } from "eve/evals";
    export default defineAgent({
      experimental: { workflow: { world: "@workflow/world-postgres" } },
      model: defineDynamic({ events: { "step.started": () => ({ modelContextWindowTokens: 128_000,
        model: mockModel(({ tools, toolResults, lastUserMessage }) => {
        if (lastUserMessage === "catalog") return JSON.stringify(tools.map(tool => tool.name));
        const name = "media__inspect";
        if (!tools.some(tool => tool.name === name)) return "Memory tool missing";
        const result = toolResults.findLast(tool => tool.name === name);
        return result ? JSON.stringify(result.output) : { toolCalls: [{name, input: {}}] };
        }),
      }) } }),
    });
  `
  );
  await writeFile(
    join(directory, "agent/memory/media.ts"),
    `
    import { defineMemory, defineMemoryProvider } from "eve/memory";
    import { defineTool } from "eve/tools";
    import { always } from "eve/tools/approval";
    import { z } from "zod";
    export default defineMemory({
      scope: context => context.session.auth.current.principalId,
      provider: defineMemoryProvider({
        recall: { "turn.started": () => ({messages: []}) },
        tools: context => ({
          inspect: defineTool({
            description: "Inspect synthetic attachments only after native approval.",
            inputSchema: z.object({}),
            approval: always(),
            execute: async (_input, execution) => {
              const sandbox = await execution.getSandbox();
              const files = context.messages.flatMap(message => Array.isArray(message.content) ? message.content : [])
                .filter(part => part.type === "file");
              return {
                scope: context.memory.scope.value,
                files: await Promise.all(files.map(async part => {
                  const bytes = await sandbox.readBinaryFile({path: part.filename});
                  if (bytes === null) throw new Error("Staged attachment missing");
                  return {filename: part.filename.split("/").at(-1), mediaType: part.mediaType, content: Buffer.from(bytes).toString("utf8")};
                })),
              };
            },
          }),
        }),
      }),
    });
  `
  );
  await compileEveFixture(directory);
}, 90_000);
afterAll(async () => {
  await clearFixtureWorkflows();
  if (directory) await rm(directory, { recursive: true, force: true });
});

test("an attachment preserves memory tools and their approved durable callbacks after restart", async () => {
  await using workspace = await workspaceFixture();
  const auth = workspaceExecutionFor(workspace.personal).session.auth.current;
  const content =
    "# Synthetic source\n\nPreserve café, attribution and original bytes.\n";
  const filenames = ["source-url.md", "source-bytes.md", "source-buffer.md"];
  const port = await freePort();
  const server = await runtime(port, "127.0.0.1", directory);
  const { sessionId } = z.object({ sessionId: z.string() }).parse(
    await server.request("/probe/send", {
      address: randomUUID(),
      id: randomUUID(),
      auth,
      message: [
        { type: "text", text: "inspect attachment" },
        ...filenames.map((filename) => ({
          type: "file",
          filename,
          mediaType: "text/markdown",
          data: `data:text/markdown;base64,${Buffer.from(content).toString("base64")}`,
        })),
      ],
    })
  );
  const pending = await server.settled(sessionId);
  expect(server.output()).not.toContain(
    "Dynamic tool resolver (turn.started) failed"
  );
  const request = z
    .object({ requests: z.array(inputRequestSchema) })
    .parse(pending.findLast((event) => event.type === "input.requested")?.data)
    .requests[0];
  expect(request?.kind).toBe("tool-approval");
  if (!request) throw new Error("Missing native memory tool approval");
  await server.stop();
  const resumed = await runtime(port, "127.0.0.1", directory);
  await resumed.request(`/probe/input/${sessionId}`, {
    auth,
    responses: [{ requestId: request.requestId, optionId: "approve" }],
  });
  const completed = await resumed.settled(sessionId, 2);
  const message = z
    .object({ message: z.string() })
    .parse(
      completed.findLast((event) => event.type === "message.completed")?.data
    ).message;
  expect(JSON.parse(message)).toEqual({
    scope: auth.principalId,
    files: filenames.map((filename) => ({
      filename,
      mediaType: "text/markdown",
      content,
    })),
  });
  await resumed.request(`/probe/message/${sessionId}`, {
    message: "catalog",
    auth,
  });
  const next = await resumed.settled(sessionId, 3);
  expect(
    JSON.stringify(
      next.findLast((event) => event.type === "message.completed")?.data
    )
  ).toContain("media__inspect");
  expect(resumed.output()).not.toContain(
    "Dynamic tool resolver (turn.started) failed"
  );
  await resumed.stop();
}, 90_000);
