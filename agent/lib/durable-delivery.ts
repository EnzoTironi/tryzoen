import { createHash } from "node:crypto";
import { z } from "zod";
import type {
  ChannelDefinition,
  ChannelReceiveContext,
  ChannelSendOptions,
} from "eve/channels";
import { sleep, withTimeout } from "../../server/operations/async";
import {
  readNativeReceipt,
  recordNativeReceipt,
  withNativeDeliveryLock,
} from "../../server/messaging/native-receipts";

/** Eve checkpoints consumption with the turn; SQL indexes its acknowledged inputs. */
export interface DeliveryState {
  receipts: Record<string, string>;
}

export const deliveryContext = (
  state: DeliveryState,
  session: Parameters<NonNullable<ChannelDefinition["context"]>>[1]
) => ({ state, session });

const marker = "zoen.delivery:";
const receiptSchema = z.strictObject({
  id: z.string().min(1),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
});

export const deliverOnce: NonNullable<
  ChannelDefinition<
    DeliveryState,
    ReturnType<typeof deliveryContext>
  >["deliver"]
> = async (payload, channel) => {
  const header = payload.context?.[0];
  if (!header?.startsWith(marker)) return payload;
  const receipt = receiptSchema.parse(JSON.parse(header.slice(marker.length)));
  const previous = channel.state.receipts[receipt.id];
  if (previous !== undefined) {
    if (previous !== receipt.digest)
      throw new Error("Conflicting delivery replay");
    return undefined;
  }
  const continuation = channel.session.continuation;
  if (!continuation)
    throw new Error("Durable delivery requires a channel address");
  channel.state.receipts[receipt.id] = receipt.digest;
  const address = continuation.token;
  continuation.alias(`session:${channel.session.id}`);
  channel.session.continuation?.alias(address);
  await recordNativeReceipt({
    workspaceId: z
      .string()
      .min(1)
      .parse(channel.session.auth.current?.attributes.workspaceId),
    inputId: receipt.id,
    sessionId: channel.session.id,
    digest: receipt.digest,
  });
  return { ...payload, context: payload.context?.slice(1) };
};

export async function acceptedDelivery(
  channel: ChannelReceiveContext<DeliveryState>,
  inputId: string,
  workspaceId: string
) {
  const receipt = await readNativeReceipt(workspaceId, inputId);
  if (!receipt) return undefined;
  const session = await channel.resolveSession(`session:${receipt.sessionId}`);
  if (session && session.id !== receipt.sessionId)
    throw new Error("Native delivery resolved a different session");
  return session;
}

/** Retries may enqueue again; the durable adapter consumes a receipt only once. */
export async function sendDurableMessage(
  channel: ChannelReceiveContext<DeliveryState>,
  address: string,
  inputId: string,
  message: Parameters<
    ReturnType<ChannelReceiveContext<DeliveryState>["from"]>["send"]
  >[0],
  options: Omit<ChannelSendOptions<DeliveryState>, "state" | "turnPolicy">
) {
  const workspaceId = z
    .string()
    .min(1)
    .parse(options.auth?.attributes.workspaceId);
  return withTimeout(
    () =>
      withNativeDeliveryLock(`${workspaceId}:${address}`, async () => {
        const digest = createHash("sha256")
          .update(JSON.stringify({ address, message, auth: options.auth }))
          .digest("hex");
        const receipt = await readNativeReceipt(workspaceId, inputId);
        if (receipt && receipt.digest !== digest)
          throw new Error("Conflicting delivery replay");
        if (!receipt)
          await channel.from(address).send(message, {
            ...options,
            context: [
              marker + JSON.stringify({ id: inputId, digest }),
              ...(options.context ?? []),
            ],
            state: { receipts: {} },
            turnPolicy: "queue",
          });
        // The receipt is written by the durable delivery hook. Its session alias
        // becomes visible at Eve's next checkpoint. Never acknowledge a candidate
        // before both are visible, or create a replacement for a parked receipt.
        for (;;) {
          const session = await acceptedDelivery(channel, inputId, workspaceId);
          if (session) return session;
          await sleep(100);
        }
      }),
    25_000
  );
}
