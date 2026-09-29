import { useEffect } from "react";
import type { z } from "zod";
import { useLocalMessages, type outgoingSchema } from "./persistence";
import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

export type OutgoingMessage<Input, Receipt> = Omit<
  z.infer<typeof outgoingSchema>,
  "input" | "receipt"
> & {
  input: Input;
  receipt?: Receipt;
};

/** Account-scoped, navigation-safe local echoes. Delivery is owned by the transport. */
export function useMessageOutbox<Input, Receipt>(
  key: readonly string[],
  deliver: (input: Input, id: string) => Promise<Receipt>,
  onFailure?: (id: string, error: unknown) => void
) {
  const client = useQueryClient();
  const persistence = useLocalMessages();
  type Entry = OutgoingMessage<Input, Receipt>;
  const query = useQuery<Entry[]>({
    queryKey: key,
    queryFn: skipToken,
    initialData: [],
    staleTime: Infinity,
    gcTime: Infinity,
  });
  const update = (id: string, change: Partial<Entry>) => {
    // Never recreate a cleared account cache from a late response.
    client.setQueryData<Entry[]>(key, (current) =>
      current?.map((entry) =>
        entry.id === id ? { ...entry, ...change } : entry
      )
    );
  };
  const mutation = useMutation({
    mutationKey: key,
    scope: { id: JSON.stringify(key) },
    retry: false,
    gcTime: 0,
    mutationFn: async (entry: Entry) => {
      await persistence?.flush();
      if (
        !client.getQueryData<Entry[]>(key)?.some((item) => item.id === entry.id)
      )
        throw new Error("The account or conversation was closed.");
      return deliver(entry.input, entry.id);
    },
    onSuccess: (receipt, entry) => {
      update(entry.id, { status: "accepted", receipt });
    },
    onError: (error, entry) => {
      onFailure?.(entry.id, error);
      update(entry.id, { status: "failed" });
    },
  });
  const retry = (id: string, input?: Input) => {
    const entry = client
      .getQueryData<Entry[]>(key)
      ?.find((item) => item.id === id);
    if (entry?.status !== "failed") return;
    const next = {
      ...entry,
      input: input ?? entry.input,
      status: "sending" as const,
      recovered: false,
    };
    update(id, next);
    mutation.mutate(next);
  };
  useEffect(() => {
    for (const entry of query.data ?? []) {
      if (entry.recovered) retry(entry.id);
    }
  });
  return {
    entries: query.data ?? [],
    enqueue: (id: string, input: Input) => {
      const current = client.getQueryData<Entry[]>(key) ?? [];
      if (current.length >= 20)
        throw new Error(
          "Finish or remove a pending message before sending more."
        );
      const entry: Entry = {
        id,
        input,
        createdAt: Date.now(),
        status: "sending",
      };
      client.setQueryData(key, [...current, entry]);
      mutation.mutate(entry);
    },
    retry,
    remove: (ids: readonly string[]) => {
      if (!ids.length) return;
      client.setQueryData<Entry[]>(key, (current) =>
        current?.filter((entry) => !ids.includes(entry.id))
      );
    },
  };
}
