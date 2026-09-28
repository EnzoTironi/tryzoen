"use client";

import { useState } from "react";
import {
  BrainIcon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { api } from "@web/trpc/client";
import { useI18n } from "@web/i18n/context";
import { Button } from "@web/components/ui/button";
import { DocumentEditor } from "@zoen/companion-ui";
import { CompanionEditingProvider } from "../../../companion/editing";
import { PanelIntro } from "../../_components/panel-intro";
import panel from "../../_components/panel.module.css";
import styles from "../space.module.css";

export default function LearnedMemoryPage() {
  const { t } = useI18n();
  const memory = api.workspaces.memory.list.useQuery();
  const write = api.workspaces.memory.write.useMutation();
  const toggle = api.workspaces.memory.setEnabled.useMutation();
  const recover = api.workspaces.memory.recover.useMutation();
  const [editing, setEditing] = useState<string>();
  const [text, setText] = useState("");
  const [adding, setAdding] = useState(false);
  const save = async (content: string) => {
    if (!content.trim())
      throw new Error(t("Escreva uma memória antes de salvar."));
    await write.mutateAsync({
      action: editing ? "update" : "remember",
      memoryId: editing,
      text: content,
      operationId: crypto.randomUUID(),
    });
    setAdding(false);
    setEditing(undefined);
    setText("");
    await memory.refetch();
  };
  return (
    <CompanionEditingProvider>
      <div className={panel.page}>
        <PanelIntro
          image="/marketing/panel/zoen-memory.png"
          title={t("O que o Zoen aprende.")}
          description={t("Suas memórias, só neste espaço.")}
        />
        <div className={styles.actions}>
          <Button
            variant="secondary"
            onClick={() => {
              setAdding(true);
              setText("");
              setEditing(undefined);
            }}
            disabled={memory.data?.enabled === false}
          >
            <PlusIcon />
            {t("Lembrar de algo")}
          </Button>
          <Button
            variant="ghost"
            role="switch"
            aria-checked={memory.data?.enabled ?? true}
            aria-label={t("Memória ativa")}
            disabled={
              toggle.isPending || !memory.data || !memory.data.workspaceEnabled
            }
            onClick={() => {
              void toggle
                .mutateAsync({ enabled: !memory.data?.enabled })
                .then(async () => memory.refetch())
                .catch(() => undefined);
            }}
          >
            {memory.data?.enabled === false ? <PlayIcon /> : <PauseIcon />}
            {memory.data?.enabled === false ? t("Retomar") : t("Pausar")}
          </Button>
        </div>
        {memory.data?.enabled === false && (
          <p className={styles.empty}>
            {t("O Zoen está pausado para aprender e usar estas memórias.")}
          </p>
        )}
        {(adding || editing) && (
          <DocumentEditor
            markdown
            title="MEMORY.md"
            label={t("O que você quer lembrar?")}
            description={t(
              "Uma preferência ou fato para lembrar neste espaço."
            )}
            initialText={text}
            maxLength={8000}
            onSave={save}
            onClose={() => {
              setAdding(false);
              setEditing(undefined);
            }}
          />
        )}
        {(memory.error ?? write.error ?? toggle.error ?? recover.error) && (
          <p className={styles.error} role="alert">
            {t("A memória está indisponível agora. Tente novamente.")}
          </p>
        )}
        {memory.data?.needsAttention && (
          <p className={styles.error} role="alert">
            {t(
              "Uma alteração ficou incompleta. Revise as memórias abaixo antes de retomar."
            )}
          </p>
        )}
        {memory.isPending && <output>{t("Carregando…")}</output>}
        {memory.data?.results.length === 0 && (
          <p className={styles.empty}>
            {t("As coisas importantes vão aparecer aqui.")}
          </p>
        )}
        <p className={styles.empty}>
          {t(
            "Remover uma memória interrompe a lembrança automática. Conversas, arquivos, histórico de versões e backups permanecem separados."
          )}
        </p>
        <div className={styles.list}>
          {memory.data?.results.map((item) => (
            <div className={styles.row} key={item.id}>
              <BrainIcon aria-hidden="true" />
              <span>{item.memory}</span>
              <Button
                size="icon"
                variant="ghost"
                aria-label={t("Editar memória")}
                onClick={() => {
                  setEditing(item.id);
                  setAdding(false);
                  setText(item.memory);
                }}
              >
                <PencilIcon />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label={t("Esquecer esta memória")}
                disabled={write.isPending}
                onClick={() => {
                  void write
                    .mutateAsync({
                      action: "delete",
                      memoryId: item.id,
                      operationId: crypto.randomUUID(),
                    })
                    .then(async () => memory.refetch())
                    .catch(() => undefined);
                }}
              >
                <Trash2Icon />
              </Button>
            </div>
          ))}
        </div>
        {memory.data?.needsAttention && (
          <div className={styles.actions}>
            <Button
              disabled={recover.isPending}
              onClick={() => {
                void recover
                  .mutateAsync()
                  .then(async () => memory.refetch())
                  .catch(() => undefined);
              }}
            >
              {t("Retomar com estas memórias")}
            </Button>
          </div>
        )}
        {memory.data?.workspaceEnabled === false && (
          <p className={styles.empty}>
            {t("A memória foi desativada nos plugins deste espaço.")}
          </p>
        )}
        {(!!memory.data?.results.length || memory.data?.needsAttention) && (
          <div className={styles.bottomLinks}>
            <Button
              variant="ghost"
              disabled={write.isPending}
              onClick={() => {
                if (
                  window.confirm(
                    t(
                      "Apagar suas memórias aprendidas neste espaço? Os arquivos e as conversas continuam guardados."
                    )
                  )
                ) {
                  void write
                    .mutateAsync({
                      action: "clear",
                      operationId: crypto.randomUUID(),
                    })
                    .then(async () => memory.refetch())
                    .catch(() => undefined);
                }
              }}
            >
              <Trash2Icon />
              {t("Esquecer tudo neste espaço")}
            </Button>
          </div>
        )}
      </div>
    </CompanionEditingProvider>
  );
}
