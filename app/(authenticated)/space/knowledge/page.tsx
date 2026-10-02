"use client";

import { jsonString } from "@shared/validation";
import { z } from "zod";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getUntypedClient } from "@trpc/client";
import { useQueryClient } from "@tanstack/react-query";
import { NetworkIcon, PlusIcon } from "lucide-react";

import { api } from "@web/trpc/client";
import { useI18n } from "@web/i18n/context";
import { Button } from "@web/components/ui/button";
import { Input } from "@web/components/ui/input";
import { Textarea } from "@web/components/ui/textarea";
import { OntologySchema } from "@zoen/companion-ui/ontology";
import {
  OntologyActionEditor,
  beginOntologyAction,
  ontologyActionFailure,
  type OntologyActionDraft,
} from "@zoen/companion-ui";
import { companionOntologyData } from "@shared/companion/knowledge";
import { authClient } from "@web/auth/client";
import { CompanionEditingProvider } from "../../../companion/editing";
import { OntologySources } from "./sources";
import { OntologyEntityForm, OntologyRelations } from "./entity-form";
import { PanelIntro } from "../../_components/panel-intro";
import panel from "../../_components/panel.module.css";
import styles from "../space.module.css";

export default function WorkspaceKnowledgePage() {
  const space = useSearchParams().get("space") ?? "personal";
  const account = authClient.useSession();
  const scope = `${account.data?.session.id ?? "signed-out"}:${space}`;
  return (
    <CompanionEditingProvider>
      <WorkspaceKnowledgeContent key={scope} scope={scope} />
    </CompanionEditingProvider>
  );
}

function WorkspaceKnowledgeContent({ scope }: { readonly scope: string }) {
  const { t } = useI18n();
  const utils = api.useUtils();
  const cache = useQueryClient();
  const state = api.workspaces.ontology.read.useQuery();
  const publish = api.workspaces.ontology.publish.useMutation();
  const [draft, setDraft] = useState<OntologyActionDraft | null>(null);
  const ontology = useMemo(
    () =>
      companionOntologyData(
        getUntypedClient(utils.client),
        scope,
        () => crypto.randomUUID(),
        () => {
          void utils.workspaces.ontology.read.invalidate();
          void utils.workspaces.files.invalidate();
          void cache.invalidateQueries({ queryKey: ["ontology", scope] });
        }
      ),
    [utils, scope, cache]
  );
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [parseError, setParseError] = useState(false);
  const graph = state.error ? undefined : state.data?.graph;
  const save = (next: z.output<typeof OntologySchema>) =>
    publish
      .mutateAsync({
        graph: next,
        expectedRevision: state.data?.revision ?? null,
        operationId: crypto.randomUUID(),
      })
      .then(async () => {
        await state.refetch();
        return undefined;
      });
  return (
    <div className={panel.page}>
      <PanelIntro
        image="/marketing/panel/zoen-memory.png"
        title={t("Suas ideias se conectam.")}
      />
      <Input
        aria-label={t("Buscar conhecimento")}
        placeholder={t("Buscar conhecimento")}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
        }}
      />
      {(parseError || Boolean(state.error ?? publish.error)) && (
        <p role="alert" className={styles.error}>
          {t(
            "Confira os dados e a versão antes de salvar. Seu rascunho foi preservado."
          )}
        </p>
      )}
      <div className={styles.list}>
        {graph?.entities
          .filter((entity) =>
            `${entity.name} ${entity.type}`
              .toLowerCase()
              .includes(query.toLowerCase())
          )
          .map((entity) => (
            <details key={entity.id}>
              <summary className={styles.row}>
                <NetworkIcon />
                <span>
                  {entity.name}
                  <small>
                    {t(
                      graph.types.find((type) => type.id === entity.type)
                        ?.name ?? entity.type
                    )}
                  </small>
                </span>
              </summary>
              <div className={styles.create}>
                {Object.entries(entity.properties).map(([key, claim]) => (
                  <p key={key}>
                    {t(key === "status" ? "Status" : key)}:{" "}
                    {String(claim.value ?? "—")}
                  </p>
                ))}
                {graph.links
                  .filter(
                    (link) => link.from === entity.id || link.to === entity.id
                  )
                  .map((link) => (
                    <p key={`${link.type}:${link.from}:${link.to}`}>
                      {t(
                        graph.relations.find(
                          (relation) => relation.id === link.type
                        )?.name ?? link.type
                      )}{" "}
                      ·{" "}
                      {
                        graph.entities.find(
                          (item) =>
                            item.id ===
                            (link.from === entity.id ? link.to : link.from)
                        )?.name
                      }
                    </p>
                  ))}
                <OntologySources
                  entity={entity}
                  graph={graph}
                  sourceStates={state.data?.sources ?? []}
                  mayManage={!!state.data?.mayManage}
                  pending={publish.isPending}
                  onSave={save}
                />
                {state.data?.mayManage && (
                  <OntologyRelations
                    entity={entity}
                    graph={graph}
                    pending={publish.isPending}
                    onSave={save}
                  />
                )}
                {state.data?.mayManage &&
                  graph.actions
                    .filter((action) => action.entityType === entity.type)
                    .map((action) => (
                      <Button
                        type="button"
                        variant="secondary"
                        key={action.id}
                        onClick={() => {
                          setDraft(
                            beginOntologyAction(
                              state.data,
                              entity.id,
                              action.id
                            )
                          );
                        }}
                      >
                        {t(action.name)}
                      </Button>
                    ))}
              </div>
            </details>
          ))}
      </div>
      {draft &&
        state.data?.mayManage &&
        ontologyActionFailure(state.error) !== "denied" && (
          <OntologyActionEditor
            initialDraft={draft}
            data={ontology}
            onClose={() => {
              setDraft(null);
            }}
          />
        )}
      {graph?.entities.length === 0 && (
        <p className={styles.empty}>
          {t("Pessoas, projetos e decisões. Veja como tudo se relaciona.")}
        </p>
      )}
      {state.data?.mayManage && (
        <>
          <Button
            variant="secondary"
            onClick={() => {
              setAdding(!adding);
            }}
          >
            <PlusIcon />
            {t("Adicionar")}
          </Button>
          {adding && graph && (
            <OntologyEntityForm
              graph={graph}
              pending={publish.isPending}
              onSave={(next) =>
                save(next).then(async () => {
                  setAdding(false);
                  return undefined;
                })
              }
            />
          )}
          {graph && (
            <details>
              <summary className={styles.row}>
                {t("Estrutura e relações")}
              </summary>
              <form
                className={styles.create}
                key={state.data.revision}
                onSubmit={(event) => {
                  event.preventDefault();
                  setParseError(false);
                  const parsed = jsonString(OntologySchema).safeParse(
                    z
                      .string()
                      .parse(new FormData(event.currentTarget).get("graph"))
                  );
                  if (!parsed.success) {
                    setParseError(true);
                    return;
                  }
                  void save(parsed.data).catch(() => undefined);
                }}
              >
                <Textarea
                  name="graph"
                  aria-label={t("Estrutura e relações")}
                  defaultValue={JSON.stringify(graph, null, 2)}
                  rows={14}
                />
                <Button type="submit" disabled={publish.isPending}>
                  {t("Salvar estrutura")}
                </Button>
              </form>
            </details>
          )}
        </>
      )}
    </div>
  );
}
