import assert from "node:assert/strict";
import { z } from "zod";
import { expect, test, vi } from "vitest";
import type { ChannelReceiveContext } from "eve/channels";
import type { Session } from "eve/channels";
import {
  deliveryContext,
  deliverOnce,
  sendDurableMessage,
  type DeliveryState,
} from "../durable-delivery";
import { withSignal } from "../../../server/operations/async";
import {
  readNativeReceipt,
  recordNativeReceipt,
  withNativeDeliveryLock,
} from "../../../server/messaging/native-receipts";

vi.mock("../../../server/messaging/native-receipts", () => ({
  readNativeReceipt: vi.fn<typeof readNativeReceipt>(),
  recordNativeReceipt: vi.fn<typeof recordNativeReceipt>(),
  withNativeDeliveryLock: vi.fn<typeof withNativeDeliveryLock>(),
}));

function session(id: string): Session {
  return {
    id,
    cancel: vi.fn<Session["cancel"]>(),
    clear: vi.fn<Session["clear"]>(),
    compact: vi.fn<Session["compact"]>(),
    getEventStream: vi.fn<Session["getEventStream"]>(),
    getStreamTailIndex: vi.fn<Session["getStreamTailIndex"]>(),
    reset: vi.fn<Session["reset"]>(),
    respond: vi.fn<Session["respond"]>(),
    send: vi.fn<Session["send"]>(),
  };
}
const auth = {
  principalId: "user",
  principalType: "user",
  authenticator: "synthetic",
  attributes: { workspaceId: "workspace" },
};

function fixture() {
  const receipts = new Map<string, Parameters<typeof recordNativeReceipt>[0]>();
  vi.mocked(readNativeReceipt).mockImplementation(
    async (workspaceId, inputId) => receipts.get(`${workspaceId}:${inputId}`)
  );
  vi.mocked(recordNativeReceipt).mockImplementation(async (receipt) => {
    receipts.set(`${receipt.workspaceId}:${receipt.inputId}`, receipt);
  });
  vi.mocked(withNativeDeliveryLock).mockImplementation((_address, run) =>
    run()
  );
  const state: DeliveryState = { receipts: {} };
  const aliases = new Map<string, Session>();
  let address = "conversation";
  // Only the public continuation contract is exercised by this adapter test.
  const handle = {
    id: "consumer-session",
    auth: { current: auth, initiator: auth },
    get continuation() {
      const previous = address;
      return {
        token: previous,
        alias(next: string) {
          aliases.set(previous, session("consumer-session"));
          aliases.set(next, session("consumer-session"));
          address = next;
        },
      };
    },
  } satisfies Parameters<typeof deliveryContext>[1];
  const context = deliveryContext(state, handle);
  async function consume(
    message: string,
    options: { context?: readonly string[] }
  ) {
    const payload = { message, context: options.context };
    const accepted = await deliverOnce(payload, context);
    // This is a different candidate from the session that actually consumed the message.
    return { payload, accepted, candidate: session("losing-candidate") };
  }
  const deliver = vi.fn<typeof consume>(consume);
  const resolveSession = vi.fn<
    ChannelReceiveContext<DeliveryState>["resolveSession"]
  >(async (key) => aliases.get(key));
  const channel: ChannelReceiveContext<DeliveryState> = {
    resolveSession,
    from: () => ({
      respond:
        vi.fn<
          ReturnType<ChannelReceiveContext<DeliveryState>["from"]>["respond"]
        >(),
      cancel:
        vi.fn<
          ReturnType<ChannelReceiveContext<DeliveryState>["from"]>["cancel"]
        >(),
      compact:
        vi.fn<
          ReturnType<ChannelReceiveContext<DeliveryState>["from"]>["compact"]
        >(),
      clear:
        vi.fn<
          ReturnType<ChannelReceiveContext<DeliveryState>["from"]>["clear"]
        >(),
      reset:
        vi.fn<
          ReturnType<ChannelReceiveContext<DeliveryState>["from"]>["reset"]
        >(),
      send: async (message, options) => {
        if (typeof message !== "string") throw new Error("Text fixture");
        return (await deliver(message, options)).candidate;
      },
    }),
  };
  return { state, context, handle, channel, deliver, aliases, resolveSession };
}

test("delivery confirms the checkpointed consumer, strips transport metadata and restores its address", async () => {
  const f = fixture();
  const result = await sendDurableMessage(
    f.channel,
    "conversation",
    "inbox-1",
    "Hello",
    { auth, context: ["User context"] }
  );
  expect(result.id).toBe("consumer-session");
  expect(f.deliver).toHaveBeenCalledOnce();
  const delivery = f.deliver.mock.results[0];
  assert.equal(delivery?.type, "return");
  expect((await delivery.value).accepted).toEqual({
    message: "Hello",
    context: ["User context"],
  });
  expect(f.handle.continuation.token).toBe("conversation");
  expect(f.aliases.get("session:consumer-session")?.id).toBe(result.id);
});

test("a serialized receipt consumes a repeated input once and rejects conflicting contents", async () => {
  const f = fixture();
  await sendDurableMessage(f.channel, "conversation", "inbox-1", "Hello", {
    auth,
  });
  const result = f.deliver.mock.results[0];
  assert.equal(result?.type, "return");
  const payload = (await result.value).payload;
  const recovered = deliveryContext(
    z
      .object({ receipts: z.record(z.string(), z.string()) })
      .parse(JSON.parse(JSON.stringify(f.state))),
    f.handle
  );
  expect(await deliverOnce(payload, recovered)).toBeUndefined();
  const header = payload.context?.[0];
  assert.ok(header);
  const marker = z
    .object({ id: z.string(), digest: z.string() })
    .parse(JSON.parse(header.slice("zoen.delivery:".length)));
  await expect(
    deliverOnce(
      {
        ...payload,
        context: [
          `zoen.delivery:${JSON.stringify({ ...marker, digest: "f".repeat(64) })}`,
        ],
      },
      recovered
    )
  ).rejects.toThrow("Conflicting delivery replay");
  await sendDurableMessage(f.channel, "conversation", "inbox-1", "Hello", {
    auth,
  });
  expect(f.deliver).toHaveBeenCalledOnce();
  await expect(
    sendDurableMessage(f.channel, "conversation", "inbox-1", "Changed", {
      auth,
    })
  ).rejects.toThrow("Conflicting delivery replay");
});

test("native background deliveries pass through without manufacturing receipts", async () => {
  const f = fixture();
  const payload = {
    message: "Background task completed.",
    context: ["Task state"],
  };
  expect(await deliverOnce(payload, f.context)).toBe(payload);
  expect(f.state.receipts).toEqual({});
});

test("long conversations use a fixed number of continuation aliases", async () => {
  const f = fixture();
  for (let index = 0; index < 300; index++) {
    await sendDurableMessage(
      f.channel,
      "conversation",
      `inbox-${String(index)}`,
      "Hello",
      { auth }
    );
  }
  expect(f.aliases.size).toBe(2);
  expect(Object.keys(f.state.receipts)).toHaveLength(300);
});

test("caller cancellation prevents a send and also interrupts an unconfirmed handoff", async () => {
  const f = fixture();
  const reason = new Error("Cancelled by caller");
  await expect(
    withSignal(AbortSignal.abort(reason), () =>
      sendDurableMessage(f.channel, "conversation", "inbox-1", "Hello", {
        auth,
      })
    )
  ).rejects.toBe(reason);
  expect(f.deliver).not.toHaveBeenCalled();
  const controller = new AbortController();
  f.resolveSession.mockResolvedValue(undefined);
  const pending = withSignal(controller.signal, () =>
    sendDurableMessage(f.channel, "conversation", "inbox-1", "Hello", { auth })
  );
  controller.abort(reason);
  await expect(pending).rejects.toBe(reason);
});
