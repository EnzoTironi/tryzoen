import { defineChannel, GET, POST } from "eve/channels";
import { inputResponseSchema, parseInputResponses } from "eve/client";
import { z } from "zod";
import {
  deliverOnce,
  deliveryContext,
  sendDurableMessage,
} from "../../../../../agent/lib/durable-delivery";

const principal = z.object({
  principalId: z.string(),
  principalType: z.literal("user"),
  authenticator: z.enum(["authjs", "scheduled-result"]),
  attributes: z.record(z.string(), z.string()),
});
const message = z.strictObject({
  address: z.string(),
  id: z.string(),
  message: z.string(),
  auth: principal,
});
export default defineChannel({
  context: deliveryContext,
  deliver: deliverOnce,
  routes: [
    POST("/probe/send", async (request, channel) => {
      const input = message.parse(await request.json());
      const session = await sendDurableMessage(
        channel,
        input.address,
        input.id,
        input.message,
        { auth: input.auth }
      );
      return Response.json({ sessionId: session.id });
    }),
    POST("/probe/message/:id", async (request, channel) => {
      const input = z
        .strictObject({ message: z.string(), auth: principal })
        .parse(await request.json());
      return Response.json(
        await channel
          .attachSession(z.string().min(1).parse(channel.params.id))
          .send(input.message, { auth: input.auth, turnPolicy: "queue" })
      );
    }),
    POST("/probe/respond/:address", async (request, channel) => {
      const input = z
        .object({ auth: principal, responses: z.array(inputResponseSchema) })
        .parse(await request.json());
      return Response.json(
        await channel
          .from(z.string().min(1).parse(channel.params.address))
          .respond(parseInputResponses(input.responses), { auth: input.auth })
      );
    }),
    POST("/probe/input/:id", async (request, channel) => {
      const input = z
        .strictObject({
          auth: principal,
          responses: z.array(inputResponseSchema),
        })
        .parse(await request.json());
      return Response.json(
        await channel
          .attachSession(z.string().min(1).parse(channel.params.id))
          .respond(parseInputResponses(input.responses), { auth: input.auth })
      );
    }),
    POST("/probe/cancel/:id", async (request, channel) => {
      const input = z
        .strictObject({ turnId: z.string().optional() })
        .parse(await request.json());
      return Response.json(
        await channel
          .attachSession(z.string().min(1).parse(channel.params.id))
          .cancel(input)
      );
    }),
    GET("/probe/events/:id", async (_request, channel) => {
      const session = channel.attachSession(
        z.string().min(1).parse(channel.params.id)
      );
      const tail = await session.getStreamTailIndex();
      if (tail < 0) return Response.json([]);
      const reader = (
        await session.getEventStream({ startIndex: 0 })
      ).getReader();
      const events = [];
      try {
        for (let i = 0; i <= tail; i++) {
          const item = await reader.read();
          if (item.done) throw new Error("Truncated session stream");
          events.push(item.value);
        }
      } finally {
        await reader.cancel();
      }
      return Response.json(events);
    }),
  ],
});
