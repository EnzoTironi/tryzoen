"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getUntypedClient } from "@trpc/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BrainIcon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  Trash2Icon,
  LinkIcon,
  HistoryIcon,
} from "lucide-react";
import type { z } from "zod";
import type {
  LearnedClaimChangeSchema,
  LearnedClaimSetEnabledInputSchema,
} from "@zoen/companion-ui/memory";
import { api } from "@web/trpc/client";
import { useI18n } from "@web/i18n/context";
import { Button } from "@web/components/ui/button";
import { companionAgentData } from "@shared/companion/agent-data";
import { downloadMemoryBackup } from "@web/files/download";
import { chooseMemoryArchive } from "@web/files/memory";
import {
  LearnedClaimEditor,
  LearnedClaimProvenance,
  MemoryRelations,
  MemoryHistory,
  MemoryBackup,
  createLearnedClaimEdit,
  isLearnedMemoryConflict,
  type LearnedClaimEdit,
} from "@zoen/companion-ui";
import { CompanionEditingProvider } from "../../../companion/editing";
import { PanelIntro } from "../../_components/panel-intro";
import panel from "../../_components/panel.module.css";
import styles from "../space.module.css";

export default function LearnedMemoryPage() {
  const space = useSearchParams().get("space");
  return (
    <CompanionEditingProvider>
      <LearnedMemoryContent key={space ?? "personal"} space={space} />
    </CompanionEditingProvider>
  );
}

function LearnedMemoryContent({ space }: { readonly space: string | null }) {
  const { t } = useI18n();
  const { client } = api.useUtils();
  const cacheScope = space ?? "personal";
  const cache = useQueryClient();
  const data = useMemo(
    () =>
      companionAgentData(getUntypedClient(client), () => crypto.randomUUID(), {
        backup: () => downloadMemoryBackup(window.location.origin, space),
        inspect: () => chooseMemoryArchive(window.location.origin, space),
      }).learned,
    [client, space]
  );
  const memory = useQuery({
    queryKey: ["companion-learned-memory", cacheScope],
    queryFn: () => data.read(),
  });
  const refresh = async () => {
    await Promise.all([
      cache.invalidateQueries({
        queryKey: ["companion-learned-memory", cacheScope],
      }),
      cache.invalidateQueries({
        queryKey: ["companion-claim-history", cacheScope],
      }),
    ]);
  };
  const mutation = useMutation({
    mutationFn: (action: () => Promise<void>) => action(),
    onSettled: refresh,
  });
  const [editing, setEditing] = useState<LearnedClaimEdit>();
  const [relating, setRelating] = useState<string>();
  const [history, setHistory] = useState<{ claimId?: string }>();
  const [preference, setPreference] =
    useState<z.output<typeof LearnedClaimSetEnabledInputSchema>>();
  const [removing, setRemoving] =
    useState<
      Extract<
        z.output<typeof LearnedClaimChangeSchema>,
        { action: "clear" | "tombstone" }
      >
    >();
  const disabled =
    mutation.isPending || memory.isFetching || memory.isError || !memory.data;
  const claims = memory.isError
    ? []
    : (memory.data?.snapshot.claims.flatMap((claim) =>
        claim.file.state.kind === "active"
          ? [{ claim, body: claim.file.state.body }]
          : []
      ) ?? []);
  return (
    <div className={panel.page}>
      <PanelIntro
        image="/marketing/panel/zoen-memory.png"
        title={t("O que o Zoen aprende.")}
        description={t("Suas memórias, só neste espaço.")}
      />
      <div className={styles.actions}>
        <Button
          variant="secondary"
          disabled={disabled || !memory.data.automaticEnabled}
          onClick={() => {
            if (memory.data)
              setEditing(
                createLearnedClaimEdit(memory.data, data.newOperationId)
              );
          }}
        >
          <PlusIcon />
          {t("Lembrar de algo")}
        </Button>
        <Button
          variant="ghost"
          role="switch"
          aria-checked={memory.data?.enabled ?? false}
          aria-label={t("Preferência pessoal de memória")}
          disabled={disabled}
          onClick={() => {
            if (!memory.data) return;
            const command = preference ?? {
              enabled: !memory.data.enabled,
              expectedPreferenceRevision: memory.data.preferenceRevision,
              operationId: data.newOperationId(),
            };
            setPreference(command);
            mutation.mutate(async () => {
              await data.setEnabled(command);
              setPreference(undefined);
            });
          }}
        >
          {memory.data?.enabled === false ? <PlayIcon /> : <PauseIcon />}
          {preference
            ? t("Repetir alteração de preferência")
            : memory.data?.enabled === false
              ? t("Retomar")
              : t("Pausar")}
        </Button>
        <Button
          variant="ghost"
          disabled={disabled}
          onClick={() => {
            setHistory({});
          }}
        >
          <HistoryIcon />
          {t("Pesquisar histórico")}
        </Button>
      </div>
      {memory.data?.enabled === false && (
        <p className={styles.empty}>
          {t(
            "Aprendizagem e lembrança automática pausadas. Você ainda pode revisar, corrigir ou remover memórias."
          )}
        </p>
      )}
      {memory.data?.workspaceEnabled === false && (
        <p className={styles.empty}>
          {t(
            "A memória automática foi desativada neste espaço. Sua preferência pessoal permanece separada; revisão, correção e remoção continuam disponíveis."
          )}
        </p>
      )}
      {(memory.error ?? mutation.error) && (
        <p className={styles.error} role="alert">
          {mutation.error && isLearnedMemoryConflict(mutation.error)
            ? t(
                "A memória mudou. Seu pedido foi mantido; revise a versão atual antes de tentar novamente."
              )
            : t(
                "A memória está indisponível ou a alteração não foi confirmada. Seus rascunhos foram mantidos."
              )}
        </p>
      )}
      {preference && mutation.error && (
        <div className={styles.actions}>
          <p>
            {memory.data?.enabled
              ? t("Preferência pessoal atual: ativa.")
              : t("Preferência pessoal atual: pausada.")}
          </p>
          <Button
            variant="ghost"
            disabled={disabled}
            onClick={() => {
              setPreference(undefined);
              mutation.reset();
            }}
          >
            {t("Usar a preferência atual revisada")}
          </Button>
        </div>
      )}
      {memory.isPending && <output>{t("Carregando…")}</output>}
      {memory.data && !memory.isError && !claims.length && (
        <p className={styles.empty}>
          {t("As coisas importantes vão aparecer aqui.")}
        </p>
      )}
      <p className={styles.empty}>
        {t(
          "Remover interrompe a lembrança automática. Versões anteriores e registros imutáveis das conversas continuam disponíveis nas ações separadas de revisão e arquivo."
        )}
      </p>
      <div className={styles.list}>
        {claims.map(({ claim, body }) => (
          <div key={claim.file.id}>
            <div className={styles.row}>
              <BrainIcon aria-hidden="true" />
              <span>{body.text}</span>
              <Button
                size="icon"
                variant="ghost"
                aria-label={t("Relações da memória")}
                disabled={disabled}
                onClick={() => {
                  setRelating(claim.file.id);
                }}
              >
                <LinkIcon />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label={t("Editar memória")}
                disabled={disabled}
                onClick={() => {
                  if (memory.data)
                    setEditing(
                      createLearnedClaimEdit(
                        memory.data,
                        data.newOperationId,
                        claim
                      )
                    );
                }}
              >
                <PencilIcon />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label={t("Versões registradas")}
                disabled={disabled}
                onClick={() => {
                  setHistory({ claimId: claim.file.id });
                }}
              >
                <HistoryIcon />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label={t("Esquecer esta memória")}
                disabled={disabled}
                onClick={() => {
                  if (memory.data)
                    setRemoving({
                      action: "tombstone",
                      claimId: claim.file.id,
                      expectedRevision: memory.data.snapshot.revision,
                      operationId: data.newOperationId(),
                    });
                }}
              >
                <Trash2Icon />
              </Button>
            </div>
            <LearnedClaimProvenance claim={claim} />
          </div>
        ))}
      </div>
      {memory.data && !memory.isError && (
        <MemoryBackup
          disabled={disabled}
          data={data.archives}
          onRestored={refresh}
        />
      )}
      {!!claims.length && (
        <div className={styles.bottomLinks}>
          <Button
            variant="ghost"
            disabled={disabled}
            onClick={() => {
              if (memory.data)
                setRemoving({
                  action: "clear",
                  expectedRevision: memory.data.snapshot.revision,
                  operationId: data.newOperationId(),
                });
            }}
          >
            <Trash2Icon />
            {t("Esquecer tudo neste espaço")}
          </Button>
        </div>
      )}
      {removing && (
        <section
          className={panel.sectionCard}
          aria-label={t("Confirmar remoção de memória")}
        >
          <h2 className="type-section-title">
            {removing.action === "clear"
              ? t("Remover todas as memórias atuais?")
              : t("Remover esta memória?")}
          </h2>
          <p>
            {t(
              "Versões registradas e conversas são retidas. Esta ação não redefine arquivos, autoridade da conta ou registros de exclusão."
            )}
          </p>
          {mutation.error && (
            <>
              <p role="alert">
                {t(
                  "A remoção não foi confirmada. Revise a memória atual antes de repetir o pedido."
                )}
              </p>
              <p className="type-micro">
                {memory.data?.snapshot.revision ?? t("Memória vazia")}
              </p>
              {claims
                .filter(
                  ({ claim }) =>
                    removing.action === "clear" ||
                    claim.file.id === removing.claimId
                )
                .map(({ claim, body }) => (
                  <p key={claim.file.id}>{body.text}</p>
                ))}
              <Button
                variant="ghost"
                disabled={disabled}
                onClick={() => {
                  if (memory.data) {
                    setRemoving({
                      ...removing,
                      expectedRevision: memory.data.snapshot.revision,
                      operationId: data.newOperationId(),
                    });
                    mutation.reset();
                  }
                }}
              >
                {t("Usar esta versão revisada")}
              </Button>
            </>
          )}
          <div className={styles.actions}>
            <Button
              variant="ghost"
              disabled={mutation.isPending}
              onClick={() => {
                setRemoving(undefined);
              }}
            >
              {t("Manter memórias")}
            </Button>
            <Button
              variant="destructive"
              disabled={disabled}
              onClick={() => {
                mutation.mutate(async () => {
                  await data.change(removing);
                  setRemoving(undefined);
                });
              }}
            >
              {mutation.isPending ? t("Removendo…") : t("Remover")}
            </Button>
          </div>
        </section>
      )}
      {editing && (
        <LearnedClaimEditor
          key={editing.claimId}
          initialDraft={editing}
          data={data}
          onSaved={refresh}
          onClose={() => {
            setEditing(undefined);
          }}
        />
      )}
      {relating && memory.data && (
        <MemoryRelations
          key={relating}
          claimId={relating}
          memory={memory.data}
          data={data}
          onSaved={refresh}
          onClose={() => {
            setRelating(undefined);
          }}
        />
      )}
      {history && (
        <MemoryHistory
          data={data}
          cacheScope={cacheScope}
          claimId={history.claimId}
          onClose={() => {
            setHistory(undefined);
          }}
        />
      )}
    </div>
  );
}
