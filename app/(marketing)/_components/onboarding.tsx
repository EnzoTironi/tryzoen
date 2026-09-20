"use client";

import { useI18n } from "@web/i18n/context";

import { createContext, useContext, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { MessageCircleIcon } from "lucide-react";

import type { conversationDestinations } from "../../../server/channels/destination";
import { Button, type ButtonProps } from "@web/components/ui/button";
import styles from "./onboarding.module.css";

const channels = [
  { id: "whatsapp", label: "WhatsApp", image: "/marketing/whatsapp.avif" },
  { id: "telegram", label: "Telegram", image: "/marketing/telegram.avif" },
  { id: "imessage", label: "Mensagens", image: null },
] as const;

const OnboardingContext = createContext<ReturnType<
  typeof conversationDestinations
> | null>(null);

function ChannelIcon({
  channel,
}: {
  readonly channel: (typeof channels)[number];
}) {
  return channel.image ? (
    <Image alt="" height={44} src={channel.image} unoptimized width={44} />
  ) : (
    <span className={styles.imessageIcon}>
      <MessageCircleIcon aria-hidden="true" />
    </span>
  );
}

function conversationStartHref(
  destinations: ReturnType<typeof conversationDestinations> | null
) {
  if (
    destinations?.imessage &&
    destinations.whatsapp === null &&
    destinations.telegram === null
  ) {
    return destinations.imessage;
  }
  return "/get-started";
}

export function ConversationIcons() {
  const { t } = useI18n();
  const destinations = useContext(OnboardingContext);
  return (
    <nav aria-label={t("Escolha seu mensageiro")} className={styles.icons}>
      {channels.map((channel) => {
        const destination = destinations?.[channel.id];
        if (!destination) return null;
        return (
          <Button
            aria-label={t(channel.label)}
            className={styles.iconButton}
            key={channel.id}
            nativeButton={false}
            render={<a aria-label={t(channel.label)} href={destination} />}
            size="icon"
          >
            <ChannelIcon channel={channel} />
          </Button>
        );
      })}
    </nav>
  );
}

export function OnboardingTrigger({
  children,
  ...props
}: Omit<ButtonProps, "render" | "nativeButton">) {
  const { t } = useI18n();
  const destinations = useContext(OnboardingContext);
  const href = conversationStartHref(destinations);
  return (
    <Button
      {...props}
      nativeButton={false}
      render={
        href === "/get-started" ? (
          <Link href={href} />
        ) : (
          <a aria-label={t("Começar")} href={href} />
        )
      }
    >
      {children}
    </Button>
  );
}

export function OnboardingProvider({
  children,
  destinations,
}: {
  readonly children: ReactNode;
  readonly destinations: ReturnType<typeof conversationDestinations>;
}) {
  return <OnboardingContext value={destinations}>{children}</OnboardingContext>;
}
