"use client";
import { useState } from "react";
import { api } from "@web/trpc/client";
import { Button } from "@web/components/ui/button";
import { useI18n } from "@web/i18n/context";
import { LoginForm } from "@app/(authenticated)/vault/_components/logins/form";
import { CardForm } from "@app/(authenticated)/vault/_components/cards/form";
import { VaultDelegation } from "@app/(authenticated)/vault/_components/delegation";

export function SettingsVault({
  wallet = false,
}: {
  readonly wallet?: boolean;
}) {
  const { t } = useI18n();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string>();
  const list = api.vault.list.useInfiniteQuery(
    { kind: wallet ? "payment" : "login" },
    { getNextPageParam: (page) => page.nextCursor }
  );
  const remove = api.vault.remove.useMutation({
    onSuccess: async () => {
      setRemoving(undefined);
      await list.refetch();
    },
  });
  if (adding)
    return (
      <div className="space-y-4">
        <Button
          variant="quiet"
          onClick={() => {
            setAdding(false);
          }}
        >
          {t("Cancel")}
        </Button>
        {wallet ? (
          <CardForm
            onSaved={() => {
              setAdding(false);
              void list.refetch();
            }}
          />
        ) : (
          <LoginForm
            onSaved={() => {
              setAdding(false);
              void list.refetch();
            }}
          />
        )}
      </div>
    );
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <div className="space-y-4">
      <p className="type-supporting-body text-muted-foreground">
        {t("Você escolhe quais itens o Zoen pode usar e por quanto tempo.")}
      </p>
      <Button
        onClick={() => {
          setAdding(true);
        }}
      >
        {t(wallet ? "Add card" : "Add credential")}
      </Button>
      {list.isPending && <output>{t("Loading…")}</output>}
      {list.error && (
        <div role="alert">
          <p>{t("Could not load saved items.")}</p>
          <Button onClick={() => void list.refetch()}>{t("Try again")}</Button>
        </div>
      )}
      {!list.isPending && !list.error && items.length === 0 && (
        <p className="type-supporting-body text-muted-foreground">
          {t("No saved items yet.")}
        </p>
      )}
      {items.map((item) => (
        <section
          key={item.id}
          className="space-y-2 border-b border-border py-3"
        >
          <h3 className="type-card-title">{item.label}</h3>
          <p className="type-caption text-muted-foreground">{item.account}</p>
          {item.hasSecret && <VaultDelegation itemId={item.id} />}
          {removing === item.id ? (
            <div className="space-y-2">
              <p>{t("Remove this saved item?")}</p>
              <Button
                disabled={remove.isPending}
                variant="destructive"
                onClick={() => {
                  remove.mutate({ id: item.id });
                }}
              >
                {t("Remove")}
              </Button>
              <Button
                disabled={remove.isPending}
                variant="quiet"
                onClick={() => {
                  setRemoving(undefined);
                }}
              >
                {t("Cancel")}
              </Button>
            </div>
          ) : (
            <Button
              variant="quiet"
              onClick={() => {
                remove.reset();
                setRemoving(item.id);
              }}
            >
              {t("Remove")}
            </Button>
          )}
        </section>
      ))}
      {remove.error && (
        <p role="alert">{t("Could not remove this item. Try again.")}</p>
      )}
      {list.hasNextPage && (
        <Button
          disabled={list.isFetchingNextPage}
          variant="quiet"
          onClick={() => void list.fetchNextPage()}
        >
          {t("Show more")}
        </Button>
      )}
    </div>
  );
}
