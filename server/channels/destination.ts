import { z } from "zod";
import { env } from "@shared/environment/env";
import type { channelProviderSchema } from "@shared/identity/channel-auth";
import { isE164PhoneNumber } from "@shared/identity/phone-number";

const installationId = z
  .string()
  .min(1)
  .refine((value) => value === value.trim());
const telegramUsername = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{4,31}$/u);
const whatsAppNumber = z.string().regex(/^\+[1-9][0-9]{6,14}$/u);

export function channelDestination(
  channel: z.output<typeof channelProviderSchema>
) {
  if (channel === "telegram") {
    return {
      installationId: installationId.parse(env.TELEGRAM_BOT_ID),
      url: `https://t.me/${telegramUsername.parse(env.TELEGRAM_BOT_USERNAME)}`,
      parameter: "start",
    };
  }
  return {
    installationId: installationId.parse(env.KAPSO_PHONE_NUMBER_ID),
    url: `https://wa.me/${whatsAppNumber.parse(env.KAPSO_PHONE_NUMBER).slice(1)}`,
    parameter: "text",
  };
}

export function conversationDestinations() {
  const whatsapp = whatsAppNumber.safeParse(
    env.MARKETING_WHATSAPP_NUMBER ?? env.KAPSO_PHONE_NUMBER
  );
  const telegram = telegramUsername.safeParse(
    env.MARKETING_TELEGRAM_USERNAME ?? env.TELEGRAM_BOT_USERNAME
  );
  const imessage = env.MARKETING_IMESSAGE_NUMBER ?? env.LINQ_PHONE_NUMBER;
  return {
    whatsapp: whatsapp.success
      ? `https://wa.me/${whatsapp.data.slice(1)}?text=Oi%2C+Zoen%21`
      : null,
    telegram: telegram.success ? `https://t.me/${telegram.data}` : null,
    imessage:
      installationId.safeParse(env.LINQ_CONNECTOR).success &&
      imessage &&
      isE164PhoneNumber(imessage)
        ? `sms:${imessage}`
        : null,
  };
}

/** Temporary public CTA for this weekend (remove after 2026-09-21). */
export const WEEKEND_IMESSAGE_URL =
  "sms:+16282463032?&body=Set%20this%20up%20for%20me%3A%20aiworthusing.com%2Fagent-index%2Fzoen";

export const weekendPublicDestinations = {
  whatsapp: null,
  telegram: null,
  imessage: WEEKEND_IMESSAGE_URL,
} satisfies ReturnType<typeof conversationDestinations>;
