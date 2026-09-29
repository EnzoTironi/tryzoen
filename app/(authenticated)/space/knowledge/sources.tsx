"use client";

import type { z } from "zod";
import { useState } from "react";
import type {
  OntologySchema,
  OntologySourceSchema,
  OntologySourceStateSchema,
} from "@shared/workspaces/ontology";
import { api } from "@web/trpc/client";
import { useI18n } from "@web/i18n/context";
import { Button } from "@web/components/ui/button";
import styles from "../space.module.css";
import { ontologyEvidenceTargets } from "./evidence";
import { OntologySourceForm } from "./source-form";

type Graph = z.output<typeof OntologySchema>;

export function OntologySources({
  entity,
  graph,
  sourceStates,
  mayManage,
  pending,
  onSave,
}: {
  entity: Graph["entities"][number];
  graph: Graph;
  sourceStates: z.output<typeof OntologySourceStateSchema>[];
  mayManage: boolean;
  pending: boolean;
  onSave: (graph: Graph) => Promise<void>;
}) {
  const { t } = useI18n();
  const [selected, setSelected] =
    useState<z.output<typeof OntologySourceSchema>>();
  const source = api.workspaces.files.useQuery(
    selected ? { path: selected.path, revision: selected.revision } : {},
    {
      enabled: !!selected,
    }
  );
  const targets = ontologyEvidenceTargets(entity, graph);
  return (
    <details>
      <summary className={styles.row}>{t("Fontes")}</summary>
      {targets.map((item) => (
        <div key={item.id} className={styles.create}>
          <strong>{t(item.name)}</strong>
          {!item.sources.length && (
            <small>{t("Sem evidência vinculada")}</small>
          )}
          {item.validTime && (
            <small>
              {t("Válido de")} {item.validTime.from ?? "—"} ·{" "}
              {t("Até (exclusivo)")} {item.validTime.until ?? "—"}
            </small>
          )}
          {item.sources.map((citation) => {
            const status = sourceStates.find(
              (state) =>
                state.path === citation.path &&
                state.revision === citation.revision &&
                state.excerpt === citation.excerpt
            )?.status;
            return (
              <div
                key={`${citation.path}:${citation.revision}:${citation.excerpt}`}
              >
                <Button
                  variant="ghost"
                  onClick={() => {
                    setSelected(citation);
                  }}
                >
                  {citation.path.replace(/^knowledge\//u, "")} ·{" "}
                  {citation.revision.slice(0, 8)}
                </Button>
                <blockquote className="type-body-sm wrap-break-word">
                  {citation.excerpt}
                </blockquote>
                {status !== "passage-present" && (
                  <small>
                    {t(
                      status === "passage-changed"
                        ? "O trecho mudou na fonte atual"
                        : "Fonte atual indisponível"
                    )}
                  </small>
                )}
              </div>
            );
          })}
        </div>
      ))}
      {selected && source.isPending && <output>{t("Carregando…")}</output>}
      {selected && source.error && (
        <p role="alert">{t("Não foi possível abrir esta fonte.")}</p>
      )}
      {selected && source.data?.content && (
        <pre className="type-body-sm wrap-break-word whitespace-pre-wrap">
          {source.data.content}
        </pre>
      )}
      {mayManage && (
        <OntologySourceForm
          entity={entity}
          graph={graph}
          targets={targets}
          pending={pending}
          onSave={onSave}
        />
      )}
    </details>
  );
}
