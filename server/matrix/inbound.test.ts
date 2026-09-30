import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { beforeEach, expect, it, vi } from "vitest";
import { acceptMatrixTransaction } from "./inbound";
import { MatrixEventSchema } from "./client";
import type { z } from "zod";

const mocks = vi.hoisted(() => ({
  query: vi.fn<(statement: SQL) => Promise<Record<string, unknown>[]>>(),
  project: vi.fn<() => Promise<void>>(),
}));
vi.mock("@db/queries", () => ({
  query: mocks.query,
  transaction: (run: () => Promise<unknown>) => run(),
}));
vi.mock("./activity", () => ({ projectMatrixActivity: mocks.project }));
vi.mock("./membership", () => ({
  readNativeGroupMembership: async () => "join",
}));
vi.mock("../workspaces/whatsapp", () => ({
  ingestWhatsAppMatrixEvent: async () => false,
}));
vi.mock("./network-delivery", () => ({
  acceptMatrixNetworkEvent: async () => false,
}));
vi.mock("./client", async (original) => ({
  ...(await original<typeof import("./client")>()),
  matrixConfiguration: async () => ({
    serverName: "test",
    botId: "@bot:test",
    homeserverToken: { reveal: () => "synthetic-fixture" },
  }),
}));

const dialect = new PgDialect();
const transactions = new Map<string, string>();
const received = new Set<string>();
const deliveries: unknown[][] = [];
let authorized = true;
let bound = true;
const base = MatrixEventSchema.parse({
  event_id: "$event",
  room_id: "!group:test",
  type: "m.room.message",
  sender: "@author:test",
  content: {
    msgtype: "m.text",
    body: "Explicit request",
    "m.mentions": { user_ids: ["@bot:test"] },
  },
});
const request = (events: z.infer<typeof MatrixEventSchema>[]) =>
  new Request("http://localhost/transactions", {
    method: "PUT",
    headers: { authorization: "Bearer synthetic-fixture" },
    body: JSON.stringify({ events }),
  });

beforeEach(() => {
  transactions.clear();
  received.clear();
  deliveries.length = 0;
  authorized = true;
  bound = true;
  mocks.project.mockReset().mockResolvedValue(undefined);
  mocks.query.mockReset().mockImplementation(async (statement) => {
    const compiled = dialect.sqlToQuery(statement);
    if (compiled.sql.includes("SELECT hash FROM matrix_transactions")) {
      const hash = transactions.get(String(compiled.params[0]));
      return hash ? [{ hash }] : [];
    }
    if (compiled.sql.includes("INSERT INTO matrix_transactions")) {
      transactions.set(String(compiled.params[0]), String(compiled.params[1]));
      return [];
    }
    if (compiled.sql.includes("INSERT INTO matrix_received_events")) {
      const id = String(compiled.params[0]);
      if (received.has(id)) return [];
      received.add(id);
      return [{ id }];
    }
    if (compiled.sql.includes("SELECT id, epoch FROM workspace_group_bindings"))
      return bound && compiled.params[1] === "!group:test"
        ? [{ id: "binding", epoch: "epoch" }]
        : [];
    if (compiled.sql.includes('SELECT m.user_id AS "userId"'))
      return authorized && compiled.params[1] === "@author:test"
        ? [{ userId: "better-auth:author" }]
        : [];
    if (compiled.sql.includes("INSERT INTO matrix_deliveries")) {
      deliveries.push(compiled.params);
      return [];
    }
    return [];
  });
});
it("accepts native metadata as canonical even without a Zoen string in the body", async () => {
  expect(await acceptMatrixTransaction(request([base]), "transaction")).toEqual(
    [base.event_id]
  );
  expect(deliveries).toEqual([
    [
      base.event_id,
      "binding",
      "epoch",
      "better-auth:author",
      "Explicit request",
    ],
  ]);
});
it.each([
  { body: "Zoen help" },
  { body: "@Zoen help" },
  {
    body: "> <@author:test> @Zoen help\n\nReady",
    "m.relates_to": { "m.in_reply_to": { event_id: "$quoted" } },
  },
  { body: "@Zoen help", "m.mentions": {} },
  { body: "@Zoen help", "m.mentions": { user_ids: ["@other:test"] } },
  { body: "@Zoen help", "m.mentions": { room: true } },
])(
  "never wakes from raw body, reply fallback or room-wide metadata",
  async (content) => {
    const event = MatrixEventSchema.parse({
      ...base,
      content: { msgtype: "m.text", ...content },
    });
    expect(
      await acceptMatrixTransaction(request([event]), "transaction")
    ).toEqual([]);
    expect(deliveries).toEqual([]);
  }
);
it("delivers only authored reply text to the durable request", async () => {
  const event = MatrixEventSchema.parse({
    ...base,
    content: {
      ...base.content,
      body: "> <@author:test> @Zoen previous request\n> private quote\n\n@Zoen aprovar",
      "m.relates_to": { "m.in_reply_to": { event_id: "$quoted" } },
    },
  });
  expect(
    await acceptMatrixTransaction(request([event]), "transaction")
  ).toEqual([base.event_id]);
  expect(deliveries[0]?.[4]).toBe("@Zoen aprovar");
});
it.each([
  { "org.zoen.forwarded": true },
  {
    "m.relates_to": { rel_type: "m.replace", event_id: "$original" },
    "m.new_content": base.content,
  },
])(
  "keeps copied mentions and edits from starting another agent turn",
  async (extra) => {
    const event = MatrixEventSchema.parse({
      ...base,
      content: { ...base.content, ...extra },
    });
    expect(
      await acceptMatrixTransaction(request([event]), "transaction")
    ).toEqual([]);
    expect(deliveries).toEqual([]);
  }
);
it("replays native transactions and event retries without duplicate deliveries", async () => {
  expect(await acceptMatrixTransaction(request([base]), "transaction")).toEqual(
    [base.event_id]
  );
  expect(await acceptMatrixTransaction(request([base]), "transaction")).toEqual(
    []
  );
  expect(await acceptMatrixTransaction(request([base]), "retry")).toEqual([]);
  expect(deliveries).toHaveLength(1);
  expect(mocks.project).toHaveBeenCalledTimes(3);
});
it("treats changed mention metadata as a semantic transaction conflict", async () => {
  await acceptMatrixTransaction(request([base]), "transaction");
  const changed = MatrixEventSchema.parse({
    ...base,
    content: { ...base.content, "m.mentions": { user_ids: [] } },
  });
  await expect(
    acceptMatrixTransaction(request([changed]), "transaction")
  ).rejects.toMatchObject({ reason: "conflict" });
  expect(deliveries).toHaveLength(1);
});
it.each(["revoked", "outsider", "direct", "other room", "bot"])(
  "does not grant agent access to %s",
  async (kind) => {
    if (kind === "revoked") authorized = false;
    if (kind === "direct") bound = false;
    const event = MatrixEventSchema.parse({
      ...base,
      sender:
        kind === "outsider"
          ? "@outsider:test"
          : kind === "bot"
            ? "@bot:test"
            : base.sender,
      room_id: kind === "other room" ? "!other:test" : base.room_id,
    });
    expect(
      await acceptMatrixTransaction(request([event]), "transaction")
    ).toEqual([]);
    expect(deliveries).toEqual([]);
  }
);
