import type { ChannelReceiveContext, ChannelSendOptions } from "eve/channels";
import {
  acceptedDelivery,
  sendDurableMessage,
  type DeliveryState,
} from "./durable-delivery";
import { ChannelMediaError } from "../../server/channels/media/policy";
import type { Identity } from "../../server/accounts";
import {
  ChannelDispatchError,
  channelPrincipal,
  requireChannelPrincipal,
} from "../../server/channels/principal";
import { Artifacts } from "../../server/artifacts";
import {
  Messaging,
  NativeInboxContentSchema,
  type Lease,
} from "../../server/messaging";
import { groupBindingFromPayload } from "../../server/channels/group-policy";
import { ChannelTransport } from "../../server/channels/transport";
import { loadChannelContent } from "../../server/channels/media/content";
import { mediaFailureMessage } from "../../server/channels/media/policy";

export async function handoffChannelMessage(
  channel: Identity["channel"],
  lease: Lease,
  auth: ChannelSendOptions["auth"],
  context: ChannelReceiveContext<DeliveryState>
) {
  const identity = await requireChannelPrincipal(channel, auth);
  if (lease.identityId !== identity.id)
    throw new ChannelDispatchError({ reason: "unauthorized" });
  const receipt = await Messaging.checkInboxLease(lease);
  const snapshot = receipt.nativeInput;
  const group = groupBindingFromPayload(receipt.payload);
  const principal = channelPrincipal(
    identity,
    receipt.sourceMessageId ?? undefined,
    group
  );
  if (
    !snapshot ||
    snapshot.inputId !== receipt.id ||
    snapshot.address !== (group?.conversationScope ?? identity.id) ||
    snapshot.channel !== channel ||
    snapshot.principalId !== principal.principalId
  ) {
    throw new ChannelDispatchError({ reason: "handoff_unknown" });
  }
  try {
    // Recover before touching media: accepted inputs can outlive their artifacts.
    let session = await acceptedDelivery(
      context,
      snapshot.inputId,
      principal.attributes.workspaceId
    );
    await requireChannelPrincipal(channel, auth);
    await Messaging.checkInboxLease(lease);
    if (!session) {
      let content = snapshot.content;
      if (content === null) {
        try {
          const loaded = await loadChannelContent(
            identity,
            receipt.payload,
            receipt.id
          );
          await requireChannelPrincipal(channel, auth);
          await Messaging.checkInboxLease(lease);
          const prepared = await Messaging.prepareInboxHandoff({
            lease,
            transcripts: loaded.transcripts,
            content: NativeInboxContentSchema.parse(loaded.content),
          });
          content = prepared.content;
        } catch (error) {
          if (!(error instanceof ChannelMediaError)) throw error;
          await requireChannelPrincipal(channel, auth);
          await Messaging.checkInboxLease(lease);
          await ChannelTransport.enqueueText({
            identityId: identity.id,
            deliveryKey: `unsupported:${receipt.id}`,
            text: mediaFailureMessage(error),
            ...(identity.channel === "telegram" && group
              ? {
                  deliveryTargetId: group.chatId,
                  ...(receipt.sourceMessageId
                    ? { replyToMessageId: receipt.sourceMessageId }
                    : {}),
                }
              : {}),
          });
          await Messaging.markInboxFailed({
            lease,
            reason: "adapter_rejected",
          });
          throw new ChannelDispatchError({ reason: "unsupported_media" });
        }
      } else {
        for (const attachment of receipt.payload.attachments ?? []) {
          if (
            !(await Artifacts.readForSource({
              identityId: identity.id,
              sourceInboxId: receipt.id,
              mediaId: attachment.id,
            }))
          ) {
            throw new ChannelDispatchError({ reason: "handoff_unknown" });
          }
        }
      }
      await requireChannelPrincipal(channel, auth);
      await Messaging.checkInboxLease(lease);
      session = await sendDurableMessage(
        context,
        snapshot.address,
        snapshot.inputId,
        content,
        { auth: principal }
      );
    }
    await Messaging.markAccepted({
      lease,
      receipt: { status: "accepted", sessionId: session.id },
    });
    return session;
  } catch (error) {
    if (
      error instanceof ChannelDispatchError &&
      error.reason !== "handoff_unknown"
    )
      throw error;
    await Messaging.markInboxUncertain({ lease, reason: "handoff_unknown" });
    throw new ChannelDispatchError({ reason: "handoff_unknown" });
  }
}

export async function drainChannelInbox(
  identity: Identity,
  context: ChannelReceiveContext<DeliveryState>
) {
  for (let index = 0; index < 8; index++) {
    const claim = await Messaging.claimInbox({
      identityId: identity.id,
      leaseSeconds: 150,
    });
    if (!claim) return;
    try {
      await handoffChannelMessage(
        identity.channel,
        {
          identityId: identity.id,
          id: claim.id,
          leaseToken: claim.leaseToken,
        },
        channelPrincipal(identity),
        context
      );
    } catch (error) {
      if (
        !(error instanceof ChannelDispatchError) ||
        error.reason !== "unsupported_media"
      )
        throw error;
    }
  }
}
