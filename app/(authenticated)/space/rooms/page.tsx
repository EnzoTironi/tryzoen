"use client";

import { useState } from "react";
import { ArrowLeftIcon, HashIcon, PlusIcon } from "lucide-react";
import { api } from "@web/trpc/client";
import { useI18n } from "@web/i18n/context";
import { Button } from "@web/components/ui/button";
import { Input } from "@web/components/ui/input";
import { ConnectedRoom } from "@app/companion/inbox";
import { authClient } from "@web/auth/client";
import { useSearchParams } from "next/navigation";
import { PanelIntro } from "../../_components/panel-intro";
import panel from "../../_components/panel.module.css";
import shared from "../space.module.css";
import styles from "./rooms.module.css";

export default function RoomsPage() {
  const { t } = useI18n();
  const rooms = api.workspaces.rooms.list.useQuery();
  const create = api.workspaces.rooms.create.useMutation();
  const [selected, setSelected] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [createOperation, setCreateOperation] = useState(() =>
    crypto.randomUUID()
  );
  if (selected)
    return (
      <RoomConversation
        key={selected}
        id={selected}
        mayManage={!!rooms.data?.mayManage}
        onClose={() => {
          setSelected(undefined);
          void rooms.refetch();
        }}
      />
    );
  return (
    <div className={panel.page}>
      <PanelIntro
        image="/marketing/panel/zoen-together.jpg"
        title={t("Uma conversa. Toda a equipe.")}
      />
      {rooms.isPending && <output>{t("Carregando…")}</output>}
      {rooms.data?.configured === false && (
        <p className={shared.empty}>
          {t("As salas ainda não estão disponíveis.")}
        </p>
      )}
      <div className={shared.list}>
        {rooms.data?.rooms.map((room) => (
          <button
            type="button"
            key={room.id}
            className={shared.row}
            onClick={() => {
              setSelected(room.id);
            }}
          >
            <HashIcon />
            <span>
              {room.label}
              <small>{t("Compartilhada com este espaço")}</small>
            </span>
          </button>
        ))}
      </div>
      {rooms.data?.configured && rooms.data.mayManage && !creating && (
        <div className={shared.actions}>
          <Button
            variant="outline"
            onClick={() => {
              setCreating(true);
            }}
          >
            <PlusIcon />
            {t("Criar sala")}
          </Button>
        </div>
      )}
      {creating && (
        <form
          className={shared.create}
          onSubmit={(event) => {
            event.preventDefault();
            void create
              .mutateAsync({ name: name.trim(), operationId: createOperation })
              .then(async (room) => {
                await rooms.refetch();
                setSelected(room.id);
                setCreating(false);
                setName("");
                setCreateOperation(crypto.randomUUID());
                return undefined;
              })
              .catch(() => undefined);
          }}
        >
          <Input
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
            placeholder={t("Nome da sala")}
            aria-label={t("Nome da sala")}
            maxLength={80}
            required
          />
          <Button type="submit" disabled={!name.trim() || create.isPending}>
            {t("Criar sala")}
          </Button>
        </form>
      )}
      {(rooms.error ?? create.error) && (
        <p role="alert">
          {t("Não foi possível abrir a sala. Tente novamente.")}
        </p>
      )}
    </div>
  );
}

function RoomConversation({
  id,
  mayManage,
  onClose,
}: {
  id: string;
  mayManage: boolean;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const close = api.workspaces.rooms.close.useMutation();
  const account = authClient.useSession();
  const params = useSearchParams();
  const userId = account.data?.user.id;
  if (!userId) return <output>{t("Carregando…")}</output>;
  const cacheScope = JSON.stringify([
    userId,
    params.get("space") ?? "personal",
  ]);
  return (
    <div className={styles.conversation}>
      <div className={styles.header}>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("Voltar")}
          onClick={onClose}
        >
          <ArrowLeftIcon />
        </Button>
      </div>
      <ConnectedRoom
        key={`${cacheScope}:${id}`}
        roomId={id}
        cacheScope={cacheScope}
        onBack={onClose}
      />
      {mayManage && (
        <details>
          <summary className={shared.row}>{t("Encerrar sala")}</summary>
          <p>{t("Esta sala deixará de receber mensagens.")}</p>
          <Button
            variant="destructive"
            disabled={close.isPending}
            onClick={() => {
              void close
                .mutateAsync({ id })
                .then(async () => {
                  onClose();
                  return undefined;
                })
                .catch(() => undefined);
            }}
          >
            {t("Encerrar para todos")}
          </Button>
          {close.error && (
            <p role="alert">
              {t("Não foi possível abrir a sala. Tente novamente.")}
            </p>
          )}
        </details>
      )}
      <small className={styles.hint}>
        {t("Compartilhada com este espaço")}
      </small>
    </div>
  );
}
