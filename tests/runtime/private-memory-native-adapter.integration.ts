import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir, lstat, mkdir } from "node:fs/promises";
import { basename, join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "pg";
import { beforeAll, expect, test } from "vitest";
import { z } from "zod";
import type { MemoryTurnStartedContext, MemoryToolsContext } from "eve/memory";
import { query, transaction } from "@db/queries";
import { sql } from "drizzle-orm";
import { env } from "@shared/environment/env";
import { claimSession } from "@db/services/sessions";
import learned from "../../agent/memory/learned";
import { PrivateMemoryRepository } from "../../server/memory/repository";
import {
  LearnedClaimReceiptSchema,
  LearnedClaimSearchSchema,
} from "@zoen/companion-ui/memory";
import {
  captureSessionSource,
  drainSessionSources,
} from "../../server/memory/session-capture";
import {
  decodeSessionSource,
  eraseSessionSources,
  sessionSource,
} from "../../server/memory/session-files";
import { WorkspaceAccessDenied } from "../../server/workspaces/access";
import { invokeWorkspaceTool } from "../../server/tools/workspace";
import { requireRuntimeDatabase } from "./database";
import { workspaceFixture, workspaceExecutionFor } from "./workspace-fixture";

const root = env.ZOEN_SESSION_ARCHIVE_DIR;
beforeAll(async () => {
  await requireRuntimeDatabase();
  if (
    !root ||
    !resolve(root).startsWith(`${resolve(tmpdir())}${sep}`) ||
    !basename(root).startsWith("zoen-k3-runtime-")
  )
    throw new Error(
      "Set ZOEN_SESSION_ARCHIVE_DIR to a private temporary zoen-k3-runtime-* directory before running these real integration tests."
    );
  await mkdir(root, { recursive: true, mode: 0o700 });
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0)
    throw new Error("The K3 test archive directory must be private.");
});

const body = (text: string) => ({
  text,
  sources: [],
  relations: [],
  validTime: null,
});
const changeResult = z.object({
  result: z.object({
    applied: z.boolean(),
    receipt: LearnedClaimReceiptSchema,
  }),
  current: z.object({
    messages: z.array(z.object({ id: z.string(), content: z.string() })),
  }),
});
const recallContent = z.strictObject({
  revision: LearnedClaimSearchSchema.shape.revision,
  matches: LearnedClaimSearchSchema.shape.matches,
});

function parseRecall(
  result: Awaited<ReturnType<(typeof learned.provider.recall)["turn.started"]>>
) {
  const message = result.messages[0];
  if (message?.id !== "learned-current")
    throw new Error("Expected the current learned-memory replacement");
  const content = message.content.split("\n").at(-1);
  if (!content) throw new Error("Expected canonical recall content");
  return recallContent.parse(JSON.parse(content));
}

function contextFor(
  actor: Parameters<typeof workspaceExecutionFor>[0],
  input: MemoryTurnStartedContext["turn"]["input"],
  scopeKey = `k3-native-${randomUUID()}`
) {
  const execution = workspaceExecutionFor(actor);
  return {
    ...execution,
    operationId: randomUUID(),
    messages: [],
    memory: {
      slot: "learned",
      scope: {
        namespace: "zoen-learned-v1",
        key: scopeKey,
        value: [actor.workspaceId, actor.userId],
      },
    },
    turn: { ...execution.session.turn, input },
  } satisfies MemoryTurnStartedContext;
}

function toolsContext(context: ReturnType<typeof contextFor>) {
  return {
    ...context,
    model: null,
    channel: {},
  } satisfies MemoryToolsContext;
}

async function retireNamespace(
  actor: Parameters<typeof workspaceExecutionFor>[0]
) {
  await transaction(async () => {
    const rows = await query<{ id: string }>(sql`SELECT namespace_id AS id
      FROM workspace_memory_namespace WHERE workspace_id=${actor.workspaceId}
      AND user_id=${actor.userId} FOR UPDATE`);
    for (const namespace of rows) {
      if (root) await eraseSessionSources(root, namespace.id);
      await query(
        sql`DELETE FROM workspace_memory_namespace WHERE namespace_id=${namespace.id}`
      );
      await query(
        sql`DELETE FROM workspace_memory_erasure WHERE namespace_id=${namespace.id}`
      );
    }
  });
}

for (const scope of ["personal", "company"] as const) {
  test(`${scope} native changes replay one actual claim and supersede corrections and tombstones immediately`, async () => {
    await using fixture = await workspaceFixture();
    const actor = scope === "personal" ? fixture.personal : fixture.actor;
    const context = contextFor(actor, [
      { role: "user", content: "Cedar preference" },
    ]);
    try {
      const tools = await learned.provider.tools(toolsContext(context));
      expect(Object.keys(tools).toSorted()).toEqual([
        "change_memory",
        "search_memory",
      ]);
      const initial = {
        action: "assert",
        expectedRevision: null,
        body: body("Cedar reports are weekly"),
      } satisfies Parameters<typeof tools.change_memory.execute>[0];
      const first = changeResult.parse(
        await tools.change_memory.execute(initial, context)
      ).result;
      if (!first.applied || first.receipt.claimId === null)
        throw new Error("Expected new claim");
      const claimId = first.receipt.claimId;
      const correction = changeResult.parse(
        await tools.change_memory.execute(
          {
            action: "correct",
            claimId,
            expectedRevision: first.receipt.revision,
            body: body("Cedar reports are monthly"),
          },
          { ...context, callId: randomUUID() }
        )
      );
      expect(JSON.stringify(correction.current)).toContain(
        "Cedar reports are monthly"
      );
      expect(JSON.stringify(correction.current)).not.toContain(
        "Cedar reports are weekly"
      );
      const corrected = correction.result;
      const replay = changeResult.parse(
        await tools.change_memory.execute(initial, context)
      );
      expect(replay.result).toEqual({
        applied: false,
        receipt: first.receipt,
      });
      expect(JSON.stringify(replay.current)).toContain(
        "Cedar reports are monthly"
      );
      const snapshot = await PrivateMemoryRepository.read(actor);
      expect(snapshot.snapshot.claims).toHaveLength(1);
      expect(snapshot.snapshot.claims[0]?.file.id).toBe(claimId);
      const forgotten = changeResult.parse(
        await tools.change_memory.execute(
          {
            action: "tombstone",
            claimId,
            expectedRevision: corrected.receipt.revision,
          },
          { ...context, callId: randomUUID() }
        )
      );
      expect(JSON.stringify(forgotten.current)).not.toContain(
        "Cedar reports are monthly"
      );
      expect(
        (await PrivateMemoryRepository.read(actor)).snapshot.claims[0]?.file
          .state
      ).toEqual({ kind: "tombstone" });
      const next = await learned.provider.recall["turn.started"]({
        ...context,
        operationId: randomUUID(),
      });
      expect(JSON.stringify(next)).not.toContain("Cedar reports are monthly");
      const audit = LearnedClaimSearchSchema.parse(
        await tools.search_memory.execute(
          { query: "Cedar", view: { revision: first.receipt.revision } },
          context
        )
      );
      expect(audit.matches[0]?.claim.revision).toBe(first.receipt.revision);
      expect(audit.matches[0]?.claim.file.state).toEqual({
        kind: "active",
        body: body("Cedar reports are weekly"),
      });
      expect(
        (await PrivateMemoryRepository.read(actor)).snapshot.claims[0]?.file
          .state.kind
      ).toBe("tombstone");
    } finally {
      await retireNamespace(actor);
    }
  });
}

test("native opaque session/call pairs remain distinct, bounded and replayable", async () => {
  await using fixture = await workspaceFixture();
  const actor = fixture.personal;
  const context = contextFor(actor, [{ role: "user", content: "Cedar" }]);
  try {
    const tools = await learned.provider.tools(toolsContext(context));
    const pairs = [
      { sessionId: "opaque:a", callId: "b" },
      { sessionId: "opaque", callId: "a:b" },
      { sessionId: "s".repeat(256), callId: randomUUID() },
    ];
    const receipts = [];
    let revision: string | null = null;
    for (const [index, pair] of pairs.entries()) {
      const changed: z.output<typeof changeResult>["result"] =
        changeResult.parse(
          await tools.change_memory.execute(
            {
              action: "assert",
              expectedRevision: revision,
              body: body(`Cedar opaque tuple ${index}`),
            },
            {
              ...context,
              callId: pair.callId,
              session: { ...context.session, id: pair.sessionId },
            }
          )
        ).result;
      expect(changed.applied).toBe(true);
      expect(changed.receipt.operationId.length).toBeLessThanOrEqual(256);
      receipts.push(changed.receipt);
      revision = changed.receipt.revision;
    }
    expect(new Set(receipts.map((receipt) => receipt.operationId)).size).toBe(
      3
    );
    expect(new Set(receipts.map((receipt) => receipt.claimId)).size).toBe(3);
    expect(
      (await PrivateMemoryRepository.read(actor)).snapshot.claims
    ).toHaveLength(3);
    const replay = changeResult.parse(
      await tools.change_memory.execute(
        {
          action: "assert",
          expectedRevision: null,
          body: body("Cedar opaque tuple 0"),
        },
        {
          ...context,
          callId: "b",
          session: { ...context.session, id: "opaque:a" },
        }
      )
    ).result;
    expect(replay).toEqual({ applied: false, receipt: receipts[0] });
    expect(
      (await PrivateMemoryRepository.read(actor)).snapshot.claims
    ).toHaveLength(3);
  } finally {
    await retireNamespace(actor);
  }
});

test("native text/media and compaction recall use only the bounded current request", async () => {
  await using fixture = await workspaceFixture();
  const actor = fixture.personal;
  try {
    const first = await PrivateMemoryRepository.change(actor, {
      action: "assert",
      operationId: randomUUID(),
      claimId: randomUUID(),
      expectedRevision: null,
      body: body("term31 is the in-bound preference"),
    });
    await PrivateMemoryRepository.change(actor, {
      action: "assert",
      operationId: randomUUID(),
      claimId: randomUUID(),
      expectedRevision: first.receipt.revision,
      body: body("term199 is the out-of-bound preference"),
    });
    const input = [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: Array.from(
              { length: 200 },
              (_, index) => `term${index}`
            ).join(" "),
          },
          {
            type: "image",
            image: new URL("https://example.invalid/term199.png"),
          },
        ],
      },
    ] satisfies MemoryTurnStartedContext["turn"]["input"];
    const context = contextFor(actor, input);
    const recalled = await learned.provider.recall["turn.started"](context);
    expect(JSON.stringify(recalled)).toContain(
      "term31 is the in-bound preference"
    );
    expect(JSON.stringify(recalled)).not.toContain(
      "term199 is the out-of-bound preference"
    );
    const compacted = await learned.provider.recall["compaction.completed"]({
      ...context,
      operationId: randomUUID(),
      compaction: { modelId: "test-context" },
    });
    expect(JSON.stringify(compacted)).toContain(
      "term31 is the in-bound preference"
    );
    const standalone = await learned.provider.recall["compaction.completed"]({
      ...context,
      turn: null,
      operationId: randomUUID(),
      compaction: { modelId: "test-context" },
      messages: [{ role: "user", content: "Old recalled term199 preference" }],
    });
    expect(standalone.messages[0]?.id).toBe("learned-current");
    expect(JSON.stringify(standalone)).not.toContain("out-of-bound preference");
    expect(parseRecall(standalone).matches).toEqual([]);
    const media = contextFor(
      actor,
      [
        {
          role: "user",
          content: [
            {
              type: "image",
              image: new URL("https://example.invalid/term31.png"),
            },
          ],
        },
      ],
      context.memory.scope.key
    );
    expect(
      parseRecall(await learned.provider.recall["turn.started"](media)).matches
    ).toEqual([]);
  } finally {
    await retireNamespace(actor);
  }
});

test("paused automatic memory permits explicit review but injects no facts after a correction", async () => {
  await using fixture = await workspaceFixture();
  const actor = fixture.actor;
  const context = contextFor(actor, [
    { role: "user", content: "Cedar preference" },
  ]);
  try {
    const publication = await PrivateMemoryRepository.change(actor, {
      action: "assert",
      operationId: randomUUID(),
      claimId: randomUUID(),
      expectedRevision: null,
      body: body("Cedar reports are weekly"),
    });
    const read = await PrivateMemoryRepository.read(actor);
    await PrivateMemoryRepository.setEnabled(actor, {
      operationId: randomUUID(),
      expectedPreferenceRevision: read.preferenceRevision,
      enabled: false,
    });
    const recalled = await learned.provider.recall["turn.started"](context);
    expect(JSON.stringify(recalled)).toContain("paused");
    expect(JSON.stringify(recalled)).not.toContain("Cedar reports are weekly");
    const tools = await learned.provider.tools(toolsContext(context));
    const review = await invokeWorkspaceTool(actor, {
      path: "workspace_memory_search",
      args: { query: "Cedar" },
    });
    expect(JSON.stringify(review)).toContain("Cedar reports are weekly");
    if (!publication.applied || publication.receipt.claimId === null)
      throw new Error("Expected new claim");
    const changed = changeResult.parse(
      await tools.change_memory.execute(
        {
          action: "correct",
          claimId: publication.receipt.claimId,
          expectedRevision: publication.receipt.revision,
          body: body("Cedar reports are monthly"),
        },
        context
      )
    );
    expect(JSON.stringify(changed.current)).toContain("paused");
    expect(JSON.stringify(changed.current)).not.toContain(
      "Cedar reports are monthly"
    );
    const wrong = workspaceExecutionFor(fixture.guest);
    await expect(
      tools.search_memory.execute({ query: "Cedar" }, wrong)
    ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
    const blockedAttributes: readonly Readonly<Record<string, string>>[] = [
      { chatKind: "group" },
      { conversationScope: " group:telegram:test:room" },
      { agentGrantId: randomUUID() },
      { scheduledRunId: randomUUID() },
      { protocolTaskId: randomUUID() },
    ];
    for (const attributes of blockedAttributes) {
      const principal = context.session.auth.current;
      expect(
        learned.scope({
          abortSignal: context.abortSignal,
          channel: {},
          session: {
            ...context.session,
            auth: {
              current: {
                ...principal,
                attributes: { ...principal.attributes, ...attributes },
              },
              initiator: principal,
            },
          },
        })
      ).toBeNull();
    }
  } finally {
    await retireNamespace(actor);
  }
});

function inbound(sessionId: string, text: string) {
  const source = sessionSource(
    {
      type: "message.received",
      meta: { id: randomUUID(), at: "2026-10-01T12:00:00.000Z" },
      data: { message: text, sequence: 0, turnId: "turn_0" },
    },
    sessionId
  );
  if (!source) throw new Error("Expected private user source");
  return source;
}

async function namespaceId(actor: Parameters<typeof workspaceExecutionFor>[0]) {
  const [namespace] = await query<{
    id: string;
  }>(sql`SELECT namespace_id AS id FROM workspace_memory_namespace
    WHERE workspace_id=${actor.workspaceId} AND user_id=${actor.userId}`);
  if (!namespace) throw new Error("Expected synthetic namespace");
  return namespace.id;
}

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

test("journal-only delivery commits exact replayable JSONL and capture observes effective consent", async () => {
  await using fixture = await workspaceFixture();
  const actor = fixture.actor;
  const sessionId = randomUUID();
  await claimSession(actor, sessionId);
  try {
    const source = inbound(sessionId, "Cedar journal source");
    await captureSessionSource(actor, source);
    await captureSessionSource(actor, source);
    const id = await namespaceId(actor);
    const [captured] = await query<{ count: number; high: number }>(sql`
      SELECT journal_event_count::float8 AS count, journal_high_water::float8 AS high
      FROM workspace_memory_namespace WHERE namespace_id=${id}`);
    expect(captured?.count).toBe(1);
    const disabled = await fixture.repository.publish(actor, {
      operationId: randomUUID(),
      expectedRevision: null,
      changes: [
        {
          path: "plugins/workspace.json",
          content: JSON.stringify({
            version: 1,
            enabled: ["files", "ontology"],
          }),
        },
      ],
    });
    expect(disabled.revision).toMatch(/^[a-f0-9]{40}$/);
    await captureSessionSource(
      actor,
      inbound(
        sessionId,
        "Must not learn while workspace automatic memory is disabled"
      )
    );
    const before = await query(
      sql`SELECT event_id FROM memory_session_sources WHERE namespace_id=${id}`
    );
    expect(before).toHaveLength(1);
    // Already accepted journal persistence keeps its membership admission.
    await drainSessionSources();
    const [receipt] = await query<{
      stored: boolean;
      payload: unknown;
      sequence: number;
    }>(sql`
      SELECT stored_at IS NOT NULL AS stored, payload, capture_sequence::float8 AS sequence
      FROM memory_session_sources WHERE namespace_id=${id} AND event_id=${source.eventId}`);
    expect(receipt?.stored).toBe(true);
    expect(receipt?.payload).toBeNull();
    expect(receipt?.sequence).toBe(captured?.high);
    if (!root || !receipt)
      throw new Error("Expected configured journal receipt");
    const path = join(
      root,
      id,
      "raw",
      "eve",
      hash(sessionId),
      `${hash(source.eventId)}.jsonl`
    );
    const original = await readFile(path);
    const decoded = decodeSessionSource(original);
    expect(decoded.source).toEqual(source);
    expect(decoded.captureSequence).toBe(receipt.sequence);
    expect(await drainSessionSources()).toMatchObject({ configured: true });
    expect(await readFile(path)).toEqual(original);
    expect(await readdir(join(root, id))).toEqual(["raw"]);
  } finally {
    await retireNamespace(actor);
  }
});

test("a retained erasure appearing during a real batch-row wait denies journal publication", async () => {
  await using fixture = await workspaceFixture();
  const actor = fixture.personal;
  const sessionId = randomUUID();
  await claimSession(actor, sessionId);
  const first = inbound(sessionId, "First pending source");
  const second = inbound(sessionId, "Second pending source");
  await captureSessionSource(actor, first);
  await captureSessionSource(actor, second);
  const id = await namespaceId(actor);
  const client = new Client({ connectionString: env.DATABASE_URL });
  let connected = false;
  let delivery: Promise<unknown> | undefined;
  try {
    await client.connect();
    connected = true;
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = '15s'");
    const { rows } = await client.query<{ pid: number }>(
      "SELECT pg_backend_pid() AS pid"
    );
    const pid = rows[0]?.pid;
    if (!pid) throw new Error("Expected holder PID");
    await client.query(
      "SELECT event_id FROM memory_session_sources WHERE namespace_id=$1 AND event_id=$2 FOR UPDATE",
      [id, second.eventId]
    );
    delivery = drainSessionSources().then(
      (value) => value,
      (error: unknown) => error
    );
    await expect
      .poll(
        async () => {
          const [waiting] = await query<{
            waiting: boolean;
          }>(sql`SELECT EXISTS (
        SELECT 1 FROM pg_stat_activity WHERE ${pid} = ANY(pg_blocking_pids(pid))) AS waiting`);
          return waiting?.waiting;
        },
        { timeout: 5000, interval: 25 }
      )
      .toBe(true);
    // A recovery-retained marker is a real receipt, independent of due time.
    await query(sql`INSERT INTO workspace_memory_erasure(namespace_id, owner_user_id, available_at)
      VALUES (${id}, ${actor.userId}, now()+interval '1 day')`);
    await client.query("COMMIT");
    expect(await delivery).toBeInstanceOf(AggregateError);
    const receipts = await query<{
      stored: boolean;
      failures: number;
    }>(sql`SELECT stored_at IS NOT NULL AS stored,
      delivery_failures AS failures FROM memory_session_sources WHERE namespace_id=${id} ORDER BY capture_sequence`);
    expect(receipts.map((receipt) => receipt.stored)).toEqual([false, false]);
    expect(receipts[0]?.failures).toBe(1);
    if (!root) throw new Error("Expected configured journal root");
    await expect(lstat(join(root, id, "raw"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  } finally {
    try {
      if (connected) await client.query("ROLLBACK");
    } finally {
      if (connected) await client.end();
      if (delivery) await delivery;
      await retireNamespace(actor);
    }
  }
}, 20_000);
