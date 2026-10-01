"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  useDarkAppearance,
  type MarkdownEditorHandle,
} from "@zoen/companion-ui";
import {
  XIcon,
  CheckIcon,
  HistoryIcon,
  SaveIcon,
  Trash2Icon,
} from "lucide-react";
import { api } from "@web/trpc/client";
import { useI18n } from "@web/i18n/context";
import { Button } from "@web/components/ui/button";
import { cn } from "@web/components/class-names";
import { Textarea } from "@web/components/ui/textarea";
import styles from "../../space.module.css";
import documentStyles from "./file-editor.module.css";
import { Dialog, DialogContent, DialogTitle } from "@web/components/ui/dialog";
import { FileHistory } from "./file-history";

const RichTextEditor = dynamic(
  () => import("@web/components/markdown-editor/rich-text"),
  { ssr: false }
);

export function FileEditor({
  path,
  content: initial,
  revision,
  onClose,
  onSaved,
  readOnly,
}: {
  readonly path: string;
  readonly content: string;
  readonly revision: string | null;
  readonly onClose: () => void;
  readonly onSaved: () => Promise<void>;
  readonly readOnly: boolean;
}) {
  const darkAppearance = useDarkAppearance();
  const { t } = useI18n();
  const utils = api.useUtils();
  const [content, setContent] = useState(initial);
  const [editorSeed, setEditorSeed] = useState({
    text: initial,
    generation: 0,
  });
  const editor = useRef<MarkdownEditorHandle>(null);
  const [editorError, setEditorError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [savedContent, setSavedContent] = useState(initial);
  const [baseRevision, setBaseRevision] = useState(revision);
  const [showHistory, setShowHistory] = useState(false);
  const [saved, setSaved] = useState(false);
  const write = api.workspaces.write.useMutation();
  const pendingSave = useRef<
    | { content: string; revision: string | null; operationId: string }
    | undefined
  >(undefined);
  const dirty = content !== savedContent;
  const markdown = path.endsWith(".md");
  const close = () => {
    if (saving || write.isPending) return;
    if (!dirty || window.confirm(t("Descartar alterações não salvas?")))
      onClose();
  };
  useEffect(() => {
    if (!dirty) return undefined;
    const protect = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", protect);
    return () => {
      window.removeEventListener("beforeunload", protect);
    };
  }, [dirty]);
  const save = async () => {
    if (saving || readOnly) return;
    setSaving(true);
    setEditorError(undefined);
    try {
      const current = markdown ? await editor.current?.read() : content;
      if (current === undefined) throw new Error(t("Carregando…"));
      if (current.length > 262144)
        throw new Error(t("O arquivo deve ter no máximo 262144 caracteres."));
      if (
        pendingSave.current?.content !== current ||
        pendingSave.current.revision !== baseRevision
      )
        pendingSave.current = {
          content: current,
          revision: baseRevision,
          operationId: crypto.randomUUID(),
        };
      const result = await write.mutateAsync({
        path,
        content: current,
        expectedRevision: baseRevision,
        operationId: pendingSave.current.operationId,
      });
      setBaseRevision(result.revision);
      setContent(current);
      setSavedContent(current);
      setSaved(true);
      await onSaved();
      await utils.workspaces.history.invalidate({ path });
    } catch (error) {
      setEditorError(
        error instanceof Error
          ? error.message
          : t("Não foi possível salvar. Seu texto continua aqui.")
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent
        showCloseButton={false}
        animated={false}
        aria-describedby={undefined}
        className={cn(
          "fixed inset-0 flex h-dvh w-full max-w-none! translate-0 rounded-none bg-background p-0 ring-0",
          darkAppearance && "dark"
        )}
      >
        <section className={documentStyles.surface}>
          <div className={documentStyles.header}>
            <DialogTitle className={documentStyles.filename}>
              {path.split("/").at(-1)}
            </DialogTitle>
            {revision && !readOnly && (
              <Button
                aria-label={t("Remover arquivo")}
                variant="ghost"
                size="icon"
                disabled={saving || write.isPending}
                onClick={() => {
                  if (
                    window.confirm(
                      t(
                        "Remover da versão atual? O arquivo continua no histórico."
                      )
                    )
                  )
                    void write
                      .mutateAsync({
                        path,
                        content: null,
                        expectedRevision: baseRevision,
                        operationId: crypto.randomUUID(),
                      })
                      .then(async () => {
                        await onSaved();
                        onClose();
                        return undefined;
                      })
                      .catch(() => undefined);
                }}
              >
                <Trash2Icon />
              </Button>
            )}
            <Button
              aria-label={t("Histórico")}
              variant="ghost"
              size="icon"
              onClick={() => {
                setShowHistory(!showHistory);
              }}
            >
              <HistoryIcon />
            </Button>
            <Button
              disabled={saving || write.isPending || readOnly}
              onClick={() => {
                void save().catch(() => undefined);
              }}
            >
              {saved && !dirty ? <CheckIcon /> : <SaveIcon />}
              {saving || write.isPending ? t("Salvando…") : t("Salvar")}
            </Button>{" "}
            <Button
              aria-label={t("Fechar")}
              variant="ghost"
              size="icon"
              disabled={saving || write.isPending}
              onClick={close}
            >
              <XIcon />
            </Button>{" "}
          </div>
          {showHistory && (
            <FileHistory
              path={path}
              readOnly={readOnly || saving || write.isPending}
              onRestore={(value) => {
                setContent(value);
                setEditorSeed((current) => ({
                  text: value,
                  generation: current.generation + 1,
                }));
                setShowHistory(false);
                setSaved(false);
              }}
            />
          )}
          {markdown ? (
            <RichTextEditor
              key={editorSeed.generation}
              ref={editor}
              filename={path.split("/").at(-1)}
              label={t("Conteúdo do arquivo")}
              initialMarkdown={editorSeed.text}
              description=""
              editable={!readOnly && !saving && !write.isPending}
              onDirty={() => {
                setSaved(false);
              }}
              onError={setEditorError}
              onChange={(value) => {
                setContent(value);
                setSaved(false);
              }}
            />
          ) : (
            <Textarea
              className={styles.document}
              aria-label={t("Conteúdo do arquivo")}
              value={content}
              maxLength={262144}
              spellCheck={false}
              readOnly={readOnly || saving || write.isPending}
              onChange={(event) => {
                setContent(event.target.value);
                setSaved(false);
              }}
            />
          )}
          {(write.error ?? editorError) && (
            <p className={styles.error} role="alert">
              {write.error?.data?.code === "CONFLICT"
                ? t(
                    "Este arquivo mudou. Volte e abra a versão mais recente antes de salvar."
                  )
                : (editorError ??
                  t("Não foi possível salvar. Seu texto continua aqui."))}
            </p>
          )}
          <div className={documentStyles.status}>
            <span className={styles.caption}>
              {saved && !dirty
                ? t("Salvo no seu espaço")
                : t("Só este espaço pode acessar este arquivo.")}
            </span>
          </div>
        </section>
      </DialogContent>
    </Dialog>
  );
}
