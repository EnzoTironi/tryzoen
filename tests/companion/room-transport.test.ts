import { createTRPCUntypedClient, httpLink } from "@trpc/client";
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { expect, it, vi } from "vitest";
import { companionRoomData } from "../../shared/companion/rooms";

it.each([
  "messages",
  "thread",
  "reactions",
  "readSync",
  "participate",
] as const)(
  "cancels the actual room %s transport when its foreground owner stops",
  async (operation) => {
    const transport = vi.fn<typeof fetch>(
      (_url, options) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = options?.signal;
          if (!signal) throw new Error("Missing transport cancellation");
          signal.addEventListener(
            "abort",
            () => {
              reject(new Error("Transport aborted"));
            },
            { once: true }
          );
        })
    );
    const rpc = createTRPCUntypedClient({
      links: [httpLink({ url: "http://localhost/api/trpc", fetch: transport })],
    });
    const rooms = companionRoomData(rpc, randomUUID);
    const controller = new AbortController();
    const result = rooms[operation](
      { id: randomUUID(), rootId: "$root", messageIds: ["$message"] },
      controller.signal
    );
    await vi.waitFor(() => {
      expect(transport).toHaveBeenCalledOnce();
    });
    controller.abort();
    await expect(result).rejects.toThrow(/abort/i);
    expect(transport.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  }
);

const participationId = "00000000-0000-4000-8000-000000000001";
const participationRoom = {
  id: participationId,
  workspaceId: "selected-workspace",
  roomId: "!room:test",
  label: "Synthetic room",
  epoch: "00000000-0000-4000-8000-000000000002",
  kind: "group",
};

it.each([
  { status: "joined", room: participationRoom },
  { status: "pending", id: participationId, retryAfterMs: 1000 },
])(
  "receives explicit participation status $status over the existing scoped mutation transport",
  async (receipt) => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ result: { data: receipt } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    const rpc = createTRPCUntypedClient({
      links: [
        httpLink({
          url: "http://localhost/api/trpc",
          fetch: transport,
          headers: { "x-zoen-workspace": "selected-workspace" },
        }),
      ],
    });
    const rooms = companionRoomData(rpc, randomUUID);
    expect(await rooms.participate({ id: participationId })).toEqual(receipt);
    expect(transport).toHaveBeenCalledOnce();
    const [url, options] = transport.mock.calls[0] ?? [];
    expect(url).toBe("http://localhost/api/trpc/workspaces.rooms.participate");
    expect(options?.method).toBe("POST");
    expect(new Headers(options?.headers).get("x-zoen-workspace")).toBe(
      "selected-workspace"
    );
    expect(options?.body).toBe(JSON.stringify({ id: participationId }));
  }
);

it("preserves terminal participation denial without retrying through history or a different scope", async () => {
  const denial = new Error("Synthetic forbidden participation");
  const rpc = {
    query: vi.fn<Parameters<typeof companionRoomData>[0]["query"]>(),
    mutation: vi
      .fn<Parameters<typeof companionRoomData>[0]["mutation"]>()
      .mockRejectedValue(denial),
  };
  const controller = new AbortController();
  const rooms = companionRoomData(rpc, randomUUID);
  await expect(
    rooms.participate({ id: participationId }, controller.signal)
  ).rejects.toBe(denial);
  expect(rpc.mutation).toHaveBeenCalledExactlyOnceWith(
    "workspaces.rooms.participate",
    { id: participationId },
    { signal: controller.signal }
  );
  expect(rpc.query).not.toHaveBeenCalled();
});

it.each([
  {
    status: "pending",
    id: participationId,
    retryAfterMs: 1000,
    room: participationRoom,
  },
  { status: "pending", id: participationId, retryAfterMs: 0 },
  { status: "joined", room: participationRoom, matrixId: "@viewer:test" },
  { status: "denied", id: participationId, retryAfterMs: 1000 },
])(
  "rejects invalid participation receipts without a transport fallback: %j",
  async (receipt) => {
    const rpc = {
      query: vi.fn<Parameters<typeof companionRoomData>[0]["query"]>(),
      mutation: vi
        .fn<Parameters<typeof companionRoomData>[0]["mutation"]>()
        .mockResolvedValue(receipt),
    };
    const rooms = companionRoomData(rpc, randomUUID);
    await expect(rooms.participate({ id: participationId })).rejects.toThrow(
      ZodError
    );
    expect(rpc.mutation).toHaveBeenCalledOnce();
    expect(rpc.query).not.toHaveBeenCalled();
  }
);
