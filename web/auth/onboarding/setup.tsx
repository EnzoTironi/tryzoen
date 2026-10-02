"use client";

import { useRef, useState } from "react";
import type { z } from "zod";
import { useRouter } from "next/navigation";
import { ArrowRightIcon } from "lucide-react";
import type { channelProviderSchema } from "@shared/identity/channel-auth";
import { agentFiles } from "@shared/workspaces/agent-files";
import { api } from "@web/trpc/client";
import { Button } from "@web/components/ui/button";
import { Input } from "@web/components/ui/input";
import { useI18n } from "@web/i18n/context";
import { safeCallbackUrl } from "@web/auth/channel/client";
import { ConnectionList } from "@app/(authenticated)/connections/_components/connection-list";
import { SettingsVault } from "@app/companion/settings/vault";
import { OnboardingFrame } from "./frame";
import styles from "./onboarding.module.css";

export function OnboardingSetup({
  available,
  callbackUrl,
  initialStep,
}: {
  readonly available: readonly z.output<typeof channelProviderSchema>[];
  readonly callbackUrl: string;
  readonly initialStep: "companion" | "connections";
}) {
  const { t } = useI18n();
  const router = useRouter();
  const utils = api.useUtils();
  const [step, setStep] = useState(initialStep === "connections" ? 2 : 1);
  const [name, setName] = useState<string>();
  const identity = api.companion.identity.useQuery();
  const google = api.googleWorkspace.read.useQuery();
  const identities = api.accountChannels.list.useQuery();
  const document =
    identity.data?.documents.find((item) => item.path === "agent/IDENTITY.md")
      ?.content ??
    agentFiles.find((item) => item.path === "agent/IDENTITY.md")?.content ??
    "";
  const initialName =
    /^Name:[ \t]*(\S[^\r\n]*)$/im.exec(document)?.[1]?.trim().slice(0, 80) ??
    "Zoen";
  const operation = useRef<{
    content: string;
    operationId: string;
    expectedRevision: string | null;
  } | null>(null);
  const returnTo = `/onboarding?step=connections&callbackUrl=${encodeURIComponent(callbackUrl)}`;
  const save = api.workspaces.write.useMutation({
    onError: async (error) => {
      if (error.data?.code === "CONFLICT") {
        operation.current = null;
        await identity.refetch();
      }
    },
    onSuccess: async () => {
      await utils.companion.identity.invalidate();
      setStep(2);
      router.replace(returnTo);
    },
  });
  const loading = step === 1 && identity.isPending;
  const readError = step === 1 && identity.error;
  return (
    <OnboardingFrame step={step} onStep={setStep} signedIn furthestStep={step}>
      {loading ? (
        <output>{t("Loading…")}</output>
      ) : readError ? (
        <div role="alert">
          <p>{t("Não foi possível preparar seu Companion.")}</p>
          <Button
            onClick={() => {
              void identity.refetch();
              void google.refetch();
              void identities.refetch();
            }}
          >
            {t("Try again")}
          </Button>
        </div>
      ) : step === 1 ? (
        <form
          className={styles.choiceList}
          onSubmit={(event) => {
            event.preventDefault();
            if (!identity.data || !identity.data.canEdit) return;
            const chosen = (name ?? initialName).trim();
            if (!chosen) return;
            const content = /^Name:/im.test(document)
              ? document.replace(/^Name:[^\r\n]*/im, `Name: ${chosen}`)
              : `Name: ${chosen}\n\n${document}`;
            if (operation.current?.content !== content)
              operation.current = {
                content,
                operationId: crypto.randomUUID(),
                expectedRevision: identity.data.revision,
              };
            save.mutate({ path: "agent/IDENTITY.md", ...operation.current });
          }}
        >
          <label htmlFor="companion-name" className="type-label">
            {t("Nome do Companion")}
          </label>
          <Input
            id="companion-name"
            name="companionName"
            maxLength={80}
            required
            value={name ?? initialName}
            onChange={(event) => {
              setName(event.target.value);
            }}
            disabled={save.isPending || !identity.data?.canEdit}
            autoComplete="off"
          />
          <p className={styles.note}>
            {t("Você pode mudar o nome e a personalidade depois.")}
          </p>
          {save.error && (
            <p role="alert">{t("Não foi possível salvar. Tente novamente.")}</p>
          )}
          {!identity.data?.canEdit && (
            <p role="alert">
              {t("Configure seu Companion no seu espaço pessoal.")}
            </p>
          )}
          <Button
            type="submit"
            className={styles.continue}
            disabled={
              save.isPending ||
              !identity.data?.canEdit ||
              !(name ?? initialName).trim()
            }
          >
            {save.isPending ? t("Saving…") : t("Continuar")}{" "}
            <ArrowRightIcon aria-hidden="true" />
          </Button>
        </form>
      ) : (
        <div className="space-y-6">
          {google.isPending || identities.isPending ? (
            <output>{t("Loading…")}</output>
          ) : google.error || identities.error ? (
            <div role="alert">
              <p>{t("Não foi possível carregar suas conexões")}</p>
              <Button
                onClick={() => {
                  void google.refetch();
                  void identities.refetch();
                }}
              >
                {t("Try again")}
              </Button>
            </div>
          ) : (
            <ConnectionList
              googleState={google.data.state}
              identities={identities.data}
              returnTo={returnTo}
              availableChannels={available}
            />
          )}
          <details>
            <summary className="cursor-pointer type-label">
              {t("Preparar meu cofre")}
            </summary>
            <p className={styles.note}>
              {t(
                "Adicione somente os acessos que você quer usar com seu Companion."
              )}
            </p>
            <SettingsVault />
          </details>
          <p className={styles.note}>
            {t(
              "As conexões são opcionais. Você controla as permissões e pode revisar tudo nas configurações."
            )}
          </p>
          <Button
            className={styles.continue}
            onClick={() => {
              router.push(
                callbackUrl === "/"
                  ? "/?compose=1"
                  : safeCallbackUrl(callbackUrl)
              );
            }}
          >
            {t("Começar uma conversa")} <ArrowRightIcon aria-hidden="true" />
          </Button>
        </div>
      )}
    </OnboardingFrame>
  );
}
