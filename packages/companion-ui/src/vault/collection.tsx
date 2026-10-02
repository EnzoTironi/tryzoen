import { useEffect, useState, type ReactNode } from "react";
import { AppState, Text, View } from "react-native";
import { useInfiniteQuery, useMutation } from "@tanstack/react-query";
import type { z } from "zod";
import { ActionButton } from "../button";
import { usePageStyles } from "../page";
import type { VaultData } from "./data";
import type { vaultPageInputSchema } from "./schema";
import { VaultItemForm } from "./form";
import { VaultItemDetails } from "./details";

export function VaultCollection({
  kind,
  data,
  cacheScope,
  renderPermission,
}: {
  readonly kind: "login" | "payment";
  readonly data: VaultData;
  readonly cacheScope: string;
  readonly renderPermission?: (id: string) => ReactNode;
}) {
  const pageStyles = usePageStyles();
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<string>();
  const list = useInfiniteQuery({
    queryKey: ["vault-items", cacheScope, kind],
    initialPageParam: null as z.infer<typeof vaultPageInputSchema>["cursor"],
    queryFn: ({ pageParam, signal }) =>
      data.list({ kind, cursor: pageParam }, signal),
    getNextPageParam: (page) => page.nextCursor,
    staleTime: 0,
    refetchOnMount: "always",
  });
  const refetch = list.refetch;
  useEffect(() => {
    const listener = AppState.addEventListener("change", (status) => {
      if (status === "active") void refetch();
      else {
        setAdding(false);
        setSelected(undefined);
      }
    });
    return () => {
      listener.remove();
    };
  }, [refetch]);
  const remove = useMutation({
    mutationFn: (id: string) => data.remove(id),
    retry: false,
    onSuccess: async () => {
      setSelected(undefined);
      await refetch();
    },
  });
  if (list.isError || remove.isError)
    return (
      <View style={{ gap: 16 }}>
        <Text accessibilityRole="alert">
          Could not verify saved items. Refresh before trying again.
        </Text>
        <ActionButton
          onPress={() => {
            remove.reset();
            setSelected(undefined);
            setAdding(false);
            void refetch();
          }}
        >
          Try again
        </ActionButton>
      </View>
    );
  if (list.isPending || (list.isFetching && !list.isFetchingNextPage))
    return <Text accessibilityLiveRegion="polite">Loading saved items…</Text>;
  const mayManage = list.data.pages[0]?.mayManage === true;
  if (adding && mayManage)
    return (
      <VaultItemForm
        kind={kind}
        onSave={data.create}
        onDone={() => {
          setAdding(false);
          void refetch();
        }}
      />
    );
  const items = list.data.pages.flatMap((page) => page.items);
  const item = items.find((value) => value.id === selected);
  if (item)
    return (
      <VaultItemDetails
        key={item.id}
        item={item}
        data={data}
        onChanged={() => {
          void refetch();
        }}
        mayManage={mayManage}
        pending={remove.isPending}
        onRemove={() => {
          remove.mutate(item.id);
        }}
        onBack={() => {
          setSelected(undefined);
        }}
        renderPermission={renderPermission}
      />
    );
  return (
    <View style={{ gap: 16 }}>
      <Text accessibilityRole="header" style={pageStyles.heading}>
        {kind === "login" ? "Saved logins" : "Saved cards"}
      </Text>
      <Text style={pageStyles.copy}>
        {kind === "login"
          ? "Manage saved credentials. Access for Zoen is a separate permission."
          : "Encrypted card details, not a connected wallet or a payment authorization."}
      </Text>
      {mayManage ? (
        <ActionButton
          onPress={() => {
            setAdding(true);
          }}
        >
          {kind === "login" ? "Add login" : "Add card"}
        </ActionButton>
      ) : (
        <Text>
          Only workspace owners and administrators can change saved items.
        </Text>
      )}
      {!items.length && <Text>No saved items yet.</Text>}
      {items.map((value) => (
        <View
          key={value.id}
          style={{
            borderRadius: 16,
            backgroundColor: "#f3f3f3",
            padding: 16,
            gap: 8,
          }}
        >
          <ActionButton
            quiet
            onPress={() => {
              setSelected(value.id);
            }}
          >
            {value.label}
          </ActionButton>
          <Text style={pageStyles.copy}>{value.account}</Text>
        </View>
      ))}
      {list.hasNextPage && (
        <ActionButton
          quiet
          disabled={list.isFetchingNextPage}
          onPress={() => {
            void list.fetchNextPage();
          }}
        >
          {list.isFetchingNextPage ? "Loading…" : "Show more saved items"}
        </ActionButton>
      )}
    </View>
  );
}
