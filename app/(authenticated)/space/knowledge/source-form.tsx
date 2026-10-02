"use client";

import { useState } from "react";
import { z } from "zod";
import type { ComponentProps } from "react";
import { api } from "@web/trpc/client";
import { useI18n } from "@web/i18n/context";
import { Button } from "@web/components/ui/button";
import { Input } from "@web/components/ui/input";
import { Textarea } from "@web/components/ui/textarea";
import type { OntologySources } from "./sources";
import { linkOntologyEvidence, type ontologyEvidenceTargets } from "./evidence";
import styles from "../space.module.css";

export function OntologySourceForm({
  entity,
  graph,
  targets,
  pending,
  onSave,
}: Pick<
  ComponentProps<typeof OntologySources>,
  "entity" | "graph" | "pending" | "onSave"
> & {
  targets: ReturnType<typeof ontologyEvidenceTargets>;
}) {
  const { t } = useI18n();
  const files = api.workspaces.files.useQuery({});
  const [path, setPath] = useState("");
  const [targetId, setTargetId] = useState("record");
  const [invalid, setInvalid] = useState(false);
  const [draftExcerpt, setExcerpt] = useState("");
  const candidate = api.workspaces.files.useQuery(
    { path },
    { enabled: !!path }
  );
  const available =
    files.data?.files.filter((file) => file.startsWith("knowledge/")) ?? [];
  const target = targets.find((item) => item.id === targetId);
  if (!available.length) return null;
  return (
    <form
      className={styles.create}
      onSubmit={(event) => {
        event.preventDefault();
        setInvalid(false);
        const revision = candidate.data?.revision;
        const values = new FormData(event.currentTarget);
        const excerpt = z.string().parse(values.get("excerpt") ?? "");
        if (
          !revision ||
          !path ||
          !target ||
          !candidate.data?.content?.includes(excerpt)
        ) {
          setInvalid(true);
          return;
        }
        const citation = { path, revision, excerpt };
        const from = z.string().parse(values.get("from") ?? "") || null;
        const until = z.string().parse(values.get("until") ?? "") || null;
        const validTime = from || until ? { from, until } : null;
        void onSave(
          linkOntologyEvidence(graph, entity.id, target, citation, validTime)
        ).catch(() => undefined);
      }}
    >
      <select
        className={styles.row}
        aria-label={t("Evidência para")}
        value={targetId}
        onChange={(event) => {
          setTargetId(event.target.value);
        }}
      >
        {targets.map((item) => (
          <option key={item.id} value={item.id}>
            {t(item.name)}
          </option>
        ))}
      </select>
      <select
        className={styles.row}
        aria-label={t("Arquivo de origem")}
        value={path}
        onChange={(event) => {
          setPath(event.target.value);
        }}
        required
      >
        <option value="">{t("Arquivo de origem")}</option>
        {available.map((file) => (
          <option key={file} value={file}>
            {file.replace(/^knowledge\//u, "")}
          </option>
        ))}
      </select>
      {candidate.data?.content && (
        <pre className="type-body-sm max-h-48 overflow-y-auto whitespace-pre-wrap">
          {candidate.data.content}
        </pre>
      )}
      <Textarea
        name="excerpt"
        aria-label={t("Trecho usado como evidência")}
        placeholder={t("Trecho usado como evidência")}
        maxLength={2000}
        required
        value={draftExcerpt}
        onChange={(event) => {
          setExcerpt(event.target.value);
        }}
      />
      {target?.kind !== "record" && (
        <>
          <label>
            {t("Válido de")}
            <Input
              name="from"
              type="date"
              defaultValue={target?.validTime?.from ?? ""}
              key={`${targetId}:from`}
            />
          </label>
          <label>
            {t("Até (exclusivo)")}
            <Input
              name="until"
              type="date"
              defaultValue={target?.validTime?.until ?? ""}
              key={`${targetId}:until`}
            />
          </label>
          <small>
            {t("Informe datas apenas quando constarem na evidência.")}
          </small>
        </>
      )}
      {invalid && (
        <p role="alert">{t("Copie um trecho exato da fonte selecionada.")}</p>
      )}
      <Button
        type="submit"
        disabled={
          pending ||
          !candidate.data?.revision ||
          !target ||
          (target.sources.length >= 10 &&
            !target.sources.some(
              (citation) =>
                citation.path === path &&
                citation.revision === candidate.data.revision &&
                citation.excerpt === draftExcerpt
            ))
        }
      >
        {t("Vincular fonte")}
      </Button>
    </form>
  );
}
