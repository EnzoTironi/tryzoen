import type { InfiniteData, QueryClient, Query } from "@tanstack/react-query";
import type { z } from "zod";
import type {
  roomPageSchema,
  roomThreadPageSchema,
  roomSyncPageSchema,
} from "./schema";

/** Apply one batch atomically across loaded views, or ask the observer to replay/recover. */
export function reconcileRoomHistory(
  client: QueryClient,
  queries: Query[],
  before: ReadonlyMap<string, unknown>,
  changes: z.infer<typeof roomSyncPageSchema>["changes"]
) {
  if (
    queries.some(
      (query) =>
        query.state.fetchStatus === "fetching" ||
        (query.isActive() && before.get(query.queryHash) !== query.state.data)
    )
  )
    return "retry";
  if (!changes) return "recover";
  const updates = queries
    .filter((query) => query.isActive())
    .map((query) => {
      const current = client.getQueryData<
        Parameters<typeof applyRoomChanges>[0]
      >(query.queryKey);
      return {
        query,
        data:
          current && query.state.status !== "error"
            ? applyRoomChanges(current, changes)
            : undefined,
      };
    });
  if (updates.some((item) => !item.data)) return "recover";
  for (const { query, data } of updates)
    client.setQueryData(query.queryKey, data);
  for (const query of queries.filter((item) => !item.isActive()))
    void client.invalidateQueries({
      queryKey: query.queryKey,
      exact: true,
      refetchType: "none",
    });
  return "applied";
}

/** Preserve native pagination boundaries; recovery rebases a head at 200 messages. */
export function applyRoomChanges(
  current: InfiniteData<
    z.infer<typeof roomPageSchema> &
      Partial<Pick<z.infer<typeof roomThreadPageSchema>, "parent">>
  >,
  changes: NonNullable<z.infer<typeof roomSyncPageSchema>["changes"]>
) {
  const head = current.pages[0];
  if (!head) return undefined;
  const known = new Set(
    current.pages.flatMap((page) => page.messages.map((message) => message.id))
  );
  const updated = new Map(
    changes.updated.map((message) => [message.id, message])
  );
  const replace = (message: (typeof head.messages)[number]) => {
    const next = updated.get(message.id);
    if (!next || (message.redacted && !next.redacted)) return message;
    // Redacted Matrix events no longer carry their original thread relation.
    return { ...next, rootId: message.rootId };
  };
  const added = changes.added
    .filter((message) => {
      if (
        known.has(message.id) ||
        (head.parent && message.rootId !== head.parent.id)
      )
        return false;
      known.add(message.id);
      return true;
    })
    .map(replace);
  // Wire pages contain at most 100 events. Never grow the live head indefinitely
  // or drop messages across its unchanged native pagination cursor.
  if (head.messages.length + added.length > 200) return undefined;
  return {
    ...current,
    pages: current.pages.map((page, index) => ({
      ...page,
      messages: [...page.messages.map(replace), ...(index === 0 ? added : [])],
      ...(page.parent ? { parent: replace(page.parent) } : {}),
    })),
  };
}
