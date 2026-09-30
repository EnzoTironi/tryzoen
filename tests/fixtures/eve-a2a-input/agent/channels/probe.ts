import { defineChannel, GET, POST } from "eve/channels";
export default defineChannel({
  routes: [
    POST("/probe/clear/:id", async (_request, channel) =>
      Response.json(
        await channel.attachSession(channel.params.id ?? "").clear()
      )
    ),
    GET("/probe/events/:id", async (_request, channel) => {
      const session = channel.attachSession(channel.params.id ?? "");
      const tail = await session.getStreamTailIndex();
      const reader = (
        await session.getEventStream({ startIndex: 0 })
      ).getReader();
      const events = [];
      try {
        for (let index = 0; index <= tail; index++) {
          const next = await reader.read();
          if (next.done) throw new Error("Session stream ended early");
          events.push(next.value);
        }
      } finally {
        await reader.cancel();
      }
      return Response.json(events);
    }),
  ],
});
