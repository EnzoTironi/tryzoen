"use client";

import { useState, type ComponentProps } from "react";
import { CheckIcon, ChevronRightIcon, PlusIcon } from "lucide-react";
import { ChannelAuthForm } from "@web/auth/channel/form";
import { useI18n } from "@web/i18n/context";
import { GoogleWorkspaceAction } from "../google-workspace-action";
import { LinkedChannels } from "./linked-channels";
import { PersonalWhatsApp } from "./personal-whatsapp";
import { ConnectionIcon } from "./connection-icon";
import styles from "../../_components/connections.module.css";

export function ConnectionList({
  googleState,
  identities,
  returnTo,
  kind = "all",
}: {
  readonly googleState: ComponentProps<typeof GoogleWorkspaceAction>["state"];
  readonly identities: ComponentProps<typeof LinkedChannels>["identities"];
  readonly returnTo: string;
  readonly kind?: "all" | "services" | "channels";
}) {
  const { t } = useI18n();
  const showGoogle = kind !== "channels";
  const showChannels = kind !== "services";
  const connectedGoogle = showGoogle && googleState === "connected";
  const pausedGoogle = showGoogle && googleState === "paused";
  const availableGoogle = showGoogle && !connectedGoogle && !pausedGoogle;
  const hasConnected =
    connectedGoogle || pausedGoogle || (showChannels && identities.length > 0);
  const availableChannels = (["telegram", "kapso"] as const).filter(
    (channel) =>
      showChannels &&
      !identities.some((identity) => identity.channel === channel)
  );
  return (
    <>
      <section className={styles.group} aria-label={t("Conectadas")}>
        <h2 className={styles.label}>{t("Conectadas")}</h2>
        <div className={styles.list}>
          {(connectedGoogle || pausedGoogle) && (
            <ManageGoogle state={googleState} returnTo={returnTo} />
          )}
          {showChannels && <LinkedChannels identities={identities} />}
        </div>
        {!hasConnected && (
          <p className={styles.empty}>
            {t("Suas conexões vão aparecer aqui.")}
          </p>
        )}
      </section>
      {showChannels && <PersonalWhatsApp />}
      {(availableGoogle || availableChannels.length > 0) && (
        <section className={styles.group} aria-label={t("Adicionar conexão")}>
          <h2 className={styles.label}>{t("Adicionar conexão")}</h2>
          <div className={styles.list}>
            {availableGoogle && (
              <GoogleWorkspaceAction
                state={googleState}
                returnTo={returnTo}
                className={styles.row}
              >
                <ConnectionIcon provider="google" />
                <span className={styles.copy}>
                  <span>Google</span>
                  <small>
                    {googleState === "unavailable"
                      ? t("Em preparação")
                      : t("Gmail, Agenda e Contatos")}
                  </small>
                </span>
                <PlusIcon className={styles.trailing} aria-hidden="true" />
              </GoogleWorkspaceAction>
            )}
            {availableChannels.length > 0 && (
              <ChannelAuthForm purpose="link" callbackUrl={returnTo}>
                {({ start, busy }) => (
                  <div className={styles.list}>
                    {availableChannels.map((channel) => (
                      <button
                        key={channel}
                        type="button"
                        className={styles.row}
                        disabled={busy}
                        onClick={() => {
                          start(channel);
                        }}
                      >
                        <ConnectionIcon provider={channel} />
                        <span className={styles.copy}>
                          {channel === "telegram" ? "Telegram" : "WhatsApp"}
                        </span>
                        <ChevronRightIcon
                          className={styles.trailing}
                          aria-hidden="true"
                        />
                      </button>
                    ))}
                  </div>
                )}
              </ChannelAuthForm>
            )}
          </div>
        </section>
      )}
    </>
  );
}

function ManageGoogle({
  state,
  returnTo,
}: ComponentProps<typeof GoogleWorkspaceAction>) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  if (state === "paused")
    return (
      <GoogleWorkspaceAction
        state={state}
        returnTo={returnTo}
        className={styles.row}
      >
        <ConnectionIcon provider="google" />
        <span className={styles.copy}>
          <span>Google</span>
          <small>{t("Pausado · ativar")}</small>
        </span>
        <PlusIcon className={styles.trailing} aria-hidden="true" />
      </GoogleWorkspaceAction>
    );
  return (
    <div>
      <button
        className={styles.row}
        type="button"
        onClick={() => {
          setOpen(!open);
        }}
        aria-expanded={open}
      >
        <ConnectionIcon provider="google" />
        <span className={styles.copy}>
          <span>Google</span>
          <small>{t("Gmail, Agenda e Contatos")}</small>
        </span>
        <CheckIcon className={styles.trailing} aria-hidden="true" />
      </button>
      {open && (
        <div className={styles.manage}>
          <p className="type-caption text-muted-foreground">
            {t(
              "Ao desconectar, o Zoen deixa de acessar seu Gmail, agenda e contatos."
            )}
          </p>
          <GoogleWorkspaceAction state={state} returnTo={returnTo} />
        </div>
      )}
    </div>
  );
}
