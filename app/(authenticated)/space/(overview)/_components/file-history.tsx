"use client";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { DownloadIcon, HistoryIcon } from "lucide-react";
import { api } from "@web/trpc/client";
import { useI18n } from "@web/i18n/context";
import { Button } from "@web/components/ui/button";
import { workspaceHref } from "@web/workspaces/navigation";
import styles from "../../space.module.css";

export function FileHistory({
  path,
  readOnly,
  onRestore,
}: {
  readonly path: string;
  readonly readOnly: boolean;
  readonly onRestore: (content: string) => void;
}) {
  const { t, locale } = useI18n();
  const space = useSearchParams().get("space");
  const [selectedVersion, setSelectedVersion] = useState<string>();
  const history = api.workspaces.history.useQuery({ path });
  const previous = api.workspaces.files.useQuery(
    { path, revision: selectedVersion },
    { enabled: Boolean(selectedVersion) }
  );
  return (
    <div className={styles.history}>
      {history.error && (
        <p role="alert">{t("Não foi possível abrir o histórico.")}</p>
      )}
      {history.isPending ? (
        <output>{t("Carregando…")}</output>
      ) : history.data?.length === 0 ? (
        <p>{t("O histórico começa quando você salva.")}</p>
      ) : (
        history.data?.map((entry) => (
          <button
            type="button"
            key={entry.revision}
            onClick={() => {
              setSelectedVersion(entry.revision);
            }}
            className={styles.historyRow}
          >
            <HistoryIcon aria-hidden="true" />
            <span>
              {new Intl.DateTimeFormat(locale, {
                dateStyle: "short",
                timeStyle: "short",
              }).format(new Date(entry.createdAt))}
            </span>
            <small>{entry.revision.slice(0, 7)}</small>
          </button>
        ))
      )}
      {selectedVersion && previous.isPending && (
        <output>{t("Carregando…")}</output>
      )}
      {selectedVersion && previous.error && (
        <p role="alert">{t("Não foi possível abrir esta versão.")}</p>
      )}
      {selectedVersion && previous.data?.content === null && (
        <p>{t("O arquivo não existe nesta versão.")}</p>
      )}
      {selectedVersion &&
        previous.data?.content !== null &&
        previous.data?.content !== undefined && (
          <div className={styles.version}>
            {history.data?.some(
              (entry) =>
                entry.revision === selectedVersion && entry.source === "import"
            ) && (
              <a
                href={workspaceHref(
                  `/api/workspaces/source?revision=${encodeURIComponent(selectedVersion)}`,
                  space
                )}
              >
                <DownloadIcon />
                {t("Baixar original")}
              </a>
            )}
            <pre>{previous.data.content}</pre>
            <Button
              variant="secondary"
              disabled={readOnly}
              onClick={() => {
                onRestore(previous.data?.content ?? "");
              }}
            >
              {t("Usar esta versão")}
            </Button>
          </div>
        )}
    </div>
  );
}
