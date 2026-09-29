import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

export interface OutgoingMessage<Input, Receipt> {
  id: string;
  input: Input;
  createdAt: number;
  status: "sending" | "accepted" | "failed";
  receipt?: Receipt;
}

/** Account-scoped, navigation-safe local echoes. Delivery is owned by the transport. */
export function useMessageOutbox<Input, Receipt>(
  key: readonly string[],
  deliver: (input: Input) => Promise<Receipt>
) {
  const client = useQueryClient();
  type Entry = OutgoingMessage<Input, Receipt>;
  const query = useQuery<Entry[]>({
    queryKey: key,
    queryFn: skipToken,
    initialData: [],
    staleTime: Infinity,
    gcTime: 30 * 60_000,
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
      if (
        !client.getQueryData<Entry[]>(key)?.some((item) => item.id === entry.id)
      )
        throw new Error("The account or conversation was closed.");
      return deliver(entry.input);
    },
    onSuccess: (receipt, entry) => {
      update(entry.id, { status: "accepted", receipt });
    },
    onError: (_error, entry) => {
      update(entry.id, { status: "failed" });
    },
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
    retry: (id: string, input?: Input) => {
      const entry = client
        .getQueryData<Entry[]>(key)
        ?.find((item) => item.id === id);
      if (entry?.status !== "failed") return;
      const next = {
        ...entry,
        input: input ?? entry.input,
        status: "sending" as const,
      };
      update(id, next);
      mutation.mutate(next);
    },
    remove: (ids: readonly string[]) => {
      if (!ids.length) return;
      client.setQueryData<Entry[]>(key, (current) =>
        current?.filter((entry) => !ids.includes(entry.id))
      );
    },
  };
}
