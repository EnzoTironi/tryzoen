import { z } from "zod";
import { defineTool, toolOutput } from "eve/tools";
import { ChannelTransport } from "../../channels/transport";
import { requireChannelPrincipal } from "../../channels/principal";

const Message = z.strictObject({
  kind: z.literal("message"),
  text: z.string().min(1).max(16_384),
  replyTo: z.optional(z.strictObject({ kind: z.literal("current") })),
});

export const privateMessageTool = (channel: "telegram" | "kapso") =>
  defineTool({
    description:
      "Send a plain-text message to this conversation. Use this for questions, progress and final answers. Put links in the text. Use replyTo current to quote the current incoming message. Attachments and reactions are not supported on this installation yet. Delivery is durable; never repeat a queued or uncertain message with another call.",
    inputSchema: Message,
    execute(input, context) {
      if (context.session.parent)
        throw new Error(
          "Return the result to the parent conversation instead of sending a message."
        );
      return (async function () {
        const auth =
          context.session.auth.current ??
          context.session.auth.initiator ??
          null;
        const identity = await requireChannelPrincipal(channel, auth);
        const reply = input.replyTo
          ? await z.string().min(1).parseAsync(auth?.attributes.sourceMessageId)
          : undefined;
        const transport = ChannelTransport;
        const enqueue = transport.enqueueText;
        const base = {
          identityId: identity.id,
          deliveryKey: `tool:${context.session.id}:${context.callId}`,
          text: input.text,
        };
        const intent = reply ? { ...base, replyToMessageId: reply } : base;
        await enqueue(intent);
        await transport.drainOutbox(identity.id);
        // Read the exact intent again through idempotent enqueue, not aggregate lane state.
        const receipts = await enqueue(intent);
        return {
          deliveries: receipts.map((receipt) => ({
            id: receipt.id,
            status: receipt.status,
          })),
        };
      })();
    },
    toModelOutput(output) {
      return toolOutput.text(
        `${JSON.stringify(output)}. Sent means accepted by the messaging provider, not read by the user. Queued/dispatching messages will be handled by the delivery service. Uncertain messages must not be resent. Do not repeat the message in assistant text.`
      );
    },
  });
