import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { beforeEach, expect, it, vi } from "vitest";
import { acceptMatrixTransaction } from "./inbound";
import { MatrixEventSchema } from "./client";
import type { z } from "zod";
import type { projectMatrixActivity } from "./activity";
import type { ingestWhatsAppMatrixEvent } from "../workspaces/whatsapp";
import type { acceptMatrixNetworkEvent } from "./network-delivery";

const mocks = vi.hoisted(() => ({
  query: vi.fn<(statement: SQL) => Promise<Record<string, unknown>[]>>(),
  project: vi.fn<typeof projectMatrixActivity>(),
  whatsapp: vi.fn<typeof ingestWhatsAppMatrixEvent>(),
  network: vi.fn<typeof acceptMatrixNetworkEvent>(),
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
  ingestWhatsAppMatrixEvent: mocks.whatsapp,
}));
vi.mock("./network-delivery", () => ({
  acceptMatrixNetworkEvent: mocks.network,
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
const defaultBinding = {
  id: "binding",
  workspaceId: "workspace",
  roomId: "!group:test",
  epoch: "epoch",
  organizationId: "organization",
};
let groupBindings = [{ ...defaultBinding }];
const networkBinding = {
  id: "network-conversation",
  workspaceId: "source-workspace",
  destWorkspaceId: "destination-workspace",
  grantId: "network-grant",
  destBotId: "destination-bot",
  roomId: "!network:test",
  sourceOrganizationId: "source-organization" as string | null,
  destOrganizationId: "destination-organization" as string | null,
};
let networkBindings: (typeof networkBinding)[] = [];
const admissionTrace: string[] = [];
let groupLocatorReads = 0;
let networkLocatorReads = 0;
let changedLocator: "group" | "network" | undefined;
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
  groupBindings = [{ ...defaultBinding }];
  networkBindings = [];
  admissionTrace.length = 0;
  groupLocatorReads = 0;
  networkLocatorReads = 0;
  changedLocator = undefined;
  mocks.project.mockReset().mockImplementation(async (_server, event) => {
    admissionTrace.push(`activity:${event.room_id ?? ""}`);
  });
  mocks.whatsapp.mockReset().mockResolvedValue(false);
  mocks.network.mockReset().mockResolvedValue(false);
  mocks.query.mockReset().mockImplementation(async (statement) => {
    const compiled = dialect.sqlToQuery(statement);
    const values = new Set(compiled.params.flat().map(String));
    if (
      compiled.sql.includes(
        'workspace_id AS "workspaceId", conversation_id AS "roomId"'
      )
    ) {
      groupLocatorReads += 1;
      const rows = bound
        ? groupBindings.filter((binding) => values.has(binding.roomId))
        : [];
      if (changedLocator === "group" && groupLocatorReads > 1) return [];
      return rows.map(({ id, workspaceId, roomId }) => ({
        id,
        workspaceId,
        roomId,
      }));
    }
    if (
      compiled.sql.includes('c.workspace_id AS "workspaceId"') &&
      compiled.sql.includes('b.workspace_id AS "destWorkspaceId"') &&
      compiled.sql.includes("matrix_agent_conversations")
    ) {
      networkLocatorReads += 1;
      return networkBindings
        .filter((binding) => values.has(binding.roomId))
        .map(
          ({
            id,
            workspaceId,
            destWorkspaceId,
            grantId,
            destBotId,
            roomId,
          }) => ({
            id,
            workspaceId,
            destWorkspaceId,
            grantId,
            destBotId:
              changedLocator === "network" && networkLocatorReads > 1
                ? "changed-destination-bot"
                : destBotId,
            roomId,
          })
        );
    }
    if (
      compiled.sql.includes('w.id AS "workspaceId"') &&
      compiled.sql.includes('w.organization_id AS "organizationId"')
    ) {
      const workspaces = new Map<string, string | null>();
      for (const binding of groupBindings) {
        if (
          bound &&
          (values.has(binding.id) || values.has(binding.workspaceId))
        )
          workspaces.set(binding.workspaceId, binding.organizationId);
      }
      for (const binding of networkBindings) {
        if (values.has(binding.workspaceId))
          workspaces.set(binding.workspaceId, binding.sourceOrganizationId);
        if (values.has(binding.destWorkspaceId))
          workspaces.set(binding.destWorkspaceId, binding.destOrganizationId);
      }
      return [...workspaces].map(([workspaceId, organizationId]) => ({
        workspaceId,
        organizationId,
      }));
    }
    if (compiled.sql.includes("FROM organizations")) {
      admissionTrace.push(`organization:${String(compiled.params[0])}`);
      return [{ id: compiled.params[0] }];
    }
    if (compiled.sql.includes("pg_advisory_xact_lock")) {
      if (compiled.sql.includes(", 5)"))
        admissionTrace.push(`room:${String(compiled.params[0])}`);
      if (compiled.sql.includes(", 6)"))
        admissionTrace.push(`server:${String(compiled.params[0])}`);
      return [];
    }
    if (compiled.sql.includes("SELECT hash FROM matrix_transactions")) {
      const hash = transactions.get(String(compiled.params[0]));
      return hash ? [{ hash }] : [];
    }
    if (compiled.sql.includes("INSERT INTO matrix_transactions")) {
      transactions.set(String(compiled.params[0]), String(compiled.params[1]));
      return [];
    }
    if (compiled.sql.includes("INSERT INTO matrix_received_events")) {
      admissionTrace.push(`received:${String(compiled.params[0])}`);
      const id = String(compiled.params[0]);
      if (received.has(id)) return [];
      received.add(id);
      return [{ id }];
    }
    if (
      compiled.sql.includes("SELECT id, epoch FROM workspace_group_bindings")
    ) {
      admissionTrace.push(`binding:${String(compiled.params[1])}`);
      const binding = bound
        ? groupBindings.find((row) => row.roomId === compiled.params[1])
        : undefined;
      return binding ? [{ id: binding.id, epoch: binding.epoch }] : [];
    }
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

/** Uses the real authority/admission owner with mocked SQL only. These order
 * observations do not prove PostgreSQL transaction or lock concurrency. */
it.each([false, true])(
  "fences the complete sorted organization and room set before processing a reverse=%s batch",
  async (reverse) => {
    groupBindings = [
      {
        ...defaultBinding,
        id: "binding-z",
        roomId: "!z:test",
        workspaceId: "workspace-z",
        organizationId: "organization-a",
      },
      {
        ...defaultBinding,
        id: "binding-a",
        roomId: "!a:test",
        workspaceId: "workspace-a",
        organizationId: "organization-z",
      },
    ];
    const events = groupBindings.map((binding) =>
      MatrixEventSchema.parse({
        ...base,
        event_id: `$${binding.id}`,
        room_id: binding.roomId,
      })
    );
    if (reverse) events.reverse();
    await acceptMatrixTransaction(request(events), "batch");
    expect(admissionTrace.slice(0, 5)).toEqual([
      "organization:organization-a",
      "organization:organization-z",
      "room:binding-a",
      "room:binding-z",
      "server:test",
    ]);
    expect(groupLocatorReads).toBe(2);
    expect(deliveries).toHaveLength(2);
  }
);
it("includes both source and destination organizations of a network fallback before the server fence", async () => {
  networkBindings = [{ ...networkBinding }];
  mocks.network.mockResolvedValue(true);
  const event = MatrixEventSchema.parse({
    ...base,
    room_id: networkBinding.roomId,
  });
  expect(await acceptMatrixTransaction(request([event]), "network")).toEqual([
    base.event_id,
  ]);
  expect(admissionTrace.slice(0, 3)).toEqual([
    "organization:destination-organization",
    "organization:source-organization",
    "server:test",
  ]);
  expect(networkLocatorReads).toBe(2);
  expect(mocks.network).toHaveBeenCalledWith(event);
});
it("fences a mixed group and network batch together before preserving its event order", async () => {
  networkBindings = [{ ...networkBinding }];
  mocks.network.mockResolvedValue(true);
  const networkEvent = MatrixEventSchema.parse({
    ...base,
    event_id: "$network-event",
    room_id: networkBinding.roomId,
  });
  expect(
    await acceptMatrixTransaction(request([networkEvent, base]), "mixed")
  ).toEqual([networkEvent.event_id, base.event_id]);
  expect(admissionTrace.slice(0, 5)).toEqual([
    "organization:destination-organization",
    "organization:organization",
    "organization:source-organization",
    "room:binding",
    "server:test",
  ]);
  expect(deliveries).toHaveLength(1);
  expect(mocks.network).toHaveBeenCalledWith(networkEvent);
});
it("preserves personal network fallback scopes without inventing an organization fence", async () => {
  networkBindings = [
    {
      ...networkBinding,
      sourceOrganizationId: null,
      destOrganizationId: null,
    },
  ];
  mocks.network.mockResolvedValue(true);
  const event = MatrixEventSchema.parse({
    ...base,
    room_id: networkBinding.roomId,
  });
  expect(
    await acceptMatrixTransaction(request([event]), "personal-network")
  ).toEqual([base.event_id]);
  expect(admissionTrace[0]).toBe("server:test");
  expect(
    admissionTrace.filter((entry) => entry.startsWith("organization:"))
  ).toEqual([]);
  expect(networkLocatorReads).toBe(2);
  expect(mocks.network).toHaveBeenCalledWith(event);
});
it.each(["group", "network"] as const)(
  "rejects a changed %s locator before activity, received-event writes or fallback processing",
  async (kind) => {
    changedLocator = kind;
    const event =
      kind === "network"
        ? MatrixEventSchema.parse({ ...base, room_id: networkBinding.roomId })
        : base;
    if (kind === "network") networkBindings = [{ ...networkBinding }];
    await expect(
      acceptMatrixTransaction(request([event]), "changed-locator")
    ).rejects.toMatchObject({ reason: "unavailable" });
    expect(mocks.project).not.toHaveBeenCalled();
    expect(received.size).toBe(0);
    expect(deliveries).toEqual([]);
    expect(transactions.size).toBe(0);
    expect(mocks.whatsapp).not.toHaveBeenCalled();
    expect(mocks.network).not.toHaveBeenCalled();
    expect(admissionTrace).not.toContain("server:test");
  }
);

/** Compiles actual owner statements with Drizzle's PostgreSQL dialect.
 * The SQL boundary is mocked; this does not execute PostgreSQL. */
it.each([
  {
    label: "singleton special-character room repeated",
    groupRooms: ['!z,{"quoted"}\\path:test'],
    networkRooms: [],
    rooms: [
      '!z,{"quoted"}\\path:test',
      '!z,{"quoted"}\\path:test',
      '!z,{"quoted"}\\path:test',
    ],
  },
  {
    label: "multiple special-character group and network rooms",
    groupRooms: ['!z,{"quoted"}\\path:test', "!a,brace{room}\\tail:test"],
    networkRooms: ['!network,"comma,brace{}"\\path:test'],
    rooms: [
      '!network,"comma,brace{}"\\path:test',
      '!z,{"quoted"}\\path:test',
      '!network,"comma,brace{}"\\path:test',
      "!a,brace{room}\\tail:test",
      '!z,{"quoted"}\\path:test',
    ],
  },
])(
  "binds one sorted native room array in all initial and revalidation locators for $label",
  async ({ groupRooms, networkRooms, rooms }) => {
    groupBindings = groupRooms.map((roomId, index) => ({
      ...defaultBinding,
      id: `binding-${index}`,
      workspaceId: `workspace-${index}`,
      organizationId: `organization-${index}`,
      roomId,
    }));
    networkBindings = networkRooms.map((roomId, index) => ({
      ...networkBinding,
      id: `network-${index}`,
      roomId,
    }));
    mocks.network.mockResolvedValue(true);
    const events = rooms.map((roomId, index) =>
      MatrixEventSchema.parse({
        ...base,
        event_id: `$compiled-${index}`,
        room_id: roomId,
      })
    );
    expect(
      await acceptMatrixTransaction(request(events), "compiled-room-array")
    ).toEqual(events.map((event) => event.event_id));

    const compiledLocators = mocks.query.mock.calls
      .map(([statement]) => dialect.sqlToQuery(statement))
      .filter((statement) => statement.sql.includes(" = ANY("));
    expect(compiledLocators).toHaveLength(4);
    expect(
      compiledLocators.map((statement) =>
        statement.sql.includes("matrix_agent_conversations")
          ? "network"
          : "group"
      )
    ).toEqual(["group", "network", "group", "network"]);
    const expectedRooms = [...new Set(rooms)].toSorted();
    for (const statement of compiledLocators) {
      expect(statement.sql).toContain("ANY($2::text[])");
      expect(statement.params).toEqual(["test", expectedRooms]);
      expect(Array.isArray(statement.params[1])).toBe(true);
      for (const room of expectedRooms) {
        expect(statement.sql).not.toContain(room);
      }
    }
    expect(groupLocatorReads).toBe(2);
    expect(networkLocatorReads).toBe(2);

    const organizations = [
      ...new Set([
        ...groupBindings.map((binding) => binding.organizationId),
        ...networkBindings.flatMap((binding) => [
          binding.sourceOrganizationId,
          binding.destOrganizationId,
        ]),
      ]),
    ]
      .filter((id) => id !== null)
      .toSorted();
    const fences = [
      ...organizations.map((id) => `organization:${id}`),
      ...groupBindings
        .map((binding) => binding.id)
        .toSorted()
        .map((id) => `room:${id}`),
      "server:test",
    ];
    expect(admissionTrace.slice(0, fences.length)).toEqual(fences);
    expect(mocks.project.mock.calls.map(([, event]) => event.event_id)).toEqual(
      events.map((event) => event.event_id)
    );
    expect(deliveries.map(([eventId]) => eventId)).toEqual(
      events
        .filter((event) => groupRooms.includes(event.room_id ?? ""))
        .map((event) => event.event_id)
    );
    expect(mocks.network.mock.calls.map(([event]) => event.event_id)).toEqual(
      events
        .filter((event) => networkRooms.includes(event.room_id ?? ""))
        .map((event) => event.event_id)
    );
  }
);
