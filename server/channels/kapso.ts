import { mapAsync } from "../operations/async";
import { ZodError as SchemaError } from "zod";
import { z } from "zod";
import { env } from "@shared/environment/env";
import {
  normalizeInbound,
  LoginTokenSchema,
  ProviderReferenceSchema,
  validateEventAge,
  type InboundEvent,
} from "./inbound";
import {
  detectKapsoChatKind,
  evaluateGroupMentionPolicy,
  extractKapsoGroupMentionSignals,
} from "./group-policy";
import {
  ProviderInputError,
  ProviderUncertain,
  requestProviderJson,
} from "./provider-errors";
import { downloadMediaBytes } from "./media/download";
import { ChannelMediaError } from "./media/policy";
const phone = z.string().regex(/^\+?[1-9][0-9]{5,14}$/);
const phoneId = z.string().regex(/^[1-9][0-9]{0,31}$/);
const messageId = z.string().regex(/^wamid\.[A-Za-z0-9_+/=.-]{1,240}$/);
export const KapsoInstallationSchema = z.object({
  phoneNumberId: phoneId,
  phoneNumber: phone,
});
export type KapsoInstallation = z.output<typeof KapsoInstallationSchema>;
const media = z.object({
  id: ProviderReferenceSchema,
  mime_type: z.optional(ProviderReferenceSchema),
  filename: z.optional(ProviderReferenceSchema),
  caption: z.optional(z.string()),
});
const message = z.object({
  id: messageId,
  timestamp: z.string().regex(/^[0-9]{1,12}$/),
  type: z.string(),
  from: z.optional(z.string()),
  to: z.optional(z.string()),
  text: z.optional(
    z.object({
      body: z.string(),
    })
  ),
  interactive: z.optional(
    z.object({
      type: z.string(),
      button_reply: z.optional(
        z.object({
          id: z.string(),
        })
      ),
    })
  ),
  context: z.optional(
    z.nullable(
      z.object({
        id: messageId,
        from_me: z.optional(z.boolean()),
      })
    )
  ),
  group_id: z.optional(ProviderReferenceSchema),
  mentions: z.optional(z.array(z.string()).max(32)),
  mentioned_ids: z.optional(z.array(z.string()).max(32)),
  image: z.optional(media),
  document: z.optional(media),
  audio: z.optional(media),
  video: z.optional(media),
  sticker: z.optional(media),
  kapso: z.object({
    direction: z.string(),
    status: z.string(),
    origin: z.optional(z.string()),
    mentioned: z.optional(z.boolean()),
    mentioned_business: z.optional(z.boolean()),
    reply_to_business: z.optional(z.boolean()),
    media_data: z.optional(
      z.object({
        filename: z.optional(ProviderReferenceSchema),
        content_type: z.optional(ProviderReferenceSchema),
      })
    ),
  }),
});
const envelope = z.object({
  phone_number_id: phoneId,
  message: z.optional(message),
  conversation: z.object({
    id: z.optional(ProviderReferenceSchema),
    phone_number_id: phoneId,
    phone_number: z.optional(z.string()),
    type: z.optional(z.string()),
    is_group: z.optional(z.boolean()),
  }),
});
const batch = z.object({
  batch: z.literal(true),
  type: z.string(),
  data: z.array(envelope).min(1).max(100),
});
function malformed(): never {
  throw new ProviderInputError({
    provider: "kapso",
    reason: "malformed",
  });
}
const digits = (value: string) => value.replace(/^\+/, "");
const normalizeEnvelope = async function (
  item: z.output<typeof envelope>,
  installation: KapsoInstallation,
  nowMs: number
) {
  if (
    item.phone_number_id !== installation.phoneNumberId ||
    item.conversation.phone_number_id !== installation.phoneNumberId
  ) {
    throw new ProviderInputError({
      provider: "kapso",
      reason: "wrong_installation",
    });
  }
  const incoming = item.message;
  if (
    incoming?.kapso.direction !== "inbound" ||
    (incoming.kapso.status !== "received" &&
      incoming.kapso.status !== "delivered")
  )
    return null;
  // Documented live origins; direction/status still exclude Business App sends.
  // https://docs.kapso.ai/docs/platform/webhooks/advanced#message-origin
  // History imports, missing and future origins must never become login commands.
  if (
    incoming.kapso.origin !== "cloud_api" &&
    incoming.kapso.origin !== "business_app"
  )
    return null;
  // Groups stay closed unless provider mention / reply-to-business signals exist.
  const chatKind = detectKapsoChatKind(item.conversation);
  if (incoming.type === "system") return null;
  const sender = await Promise.try(async () =>
    phone.parseAsync(incoming.from)
  ).catch(() => {
    throw new ProviderInputError({
      provider: "kapso",
      reason: "unsupported_identity",
    });
  });
  const senderId = digits(sender);
  if (senderId === digits(installation.phoneNumber)) return null;
  if (
    incoming.to !== undefined &&
    digits(incoming.to) !== digits(installation.phoneNumber)
  ) {
    throw new ProviderInputError({
      provider: "kapso",
      reason: "wrong_installation",
    });
  }
  if (chatKind === "group") {
    const mentionSignals = extractKapsoGroupMentionSignals({
      installationPhoneDigits: digits(installation.phoneNumber),
      mentions: incoming.mentions,
      mentionedIds: incoming.mentioned_ids,
      kapso: incoming.kapso,
      contextFromMe: incoming.context?.from_me === true,
    });
    if (!evaluateGroupMentionPolicy(mentionSignals)) return null;
  } else if (
    item.conversation.phone_number !== undefined &&
    digits(item.conversation.phone_number) !== senderId
  ) {
    throw new ProviderInputError({
      provider: "kapso",
      reason: "wrong_installation",
    });
  }
  const occurredAt = await validateEventAge(
    "kapso",
    Number(incoming.timestamp),
    nowMs
  );
  const coordinates = {
    channel: "kapso" as const,
    installationId: installation.phoneNumberId,
    eventId: incoming.id,
    messageId: incoming.id,
    senderId,
    occurredAt,
    chatKind,
    chatId:
      chatKind === "group"
        ? (incoming.group_id ??
          item.conversation.id ??
          item.conversation.phone_number ??
          senderId)
        : senderId,
  };
  if (incoming.type === "interactive") {
    const reply = incoming.interactive;
    if (
      chatKind !== "private" ||
      reply?.type !== "button_reply" ||
      !reply.button_reply?.id.startsWith("confirm:")
    )
      return null;
    const replyId = reply.button_reply.id;
    const token = await Promise.try(async () =>
      LoginTokenSchema.parseAsync(replyId.slice(8))
    ).catch(() => {
      return malformed();
    });
    return {
      ...coordinates,
      kind: "command" as const,
      command: "confirm" as const,
      token,
    };
  }
  let attachment: z.output<typeof media> | undefined;
  switch (incoming.type) {
    case "text":
      break;
    case "image":
      attachment = incoming.image;
      break;
    case "document":
      attachment = incoming.document;
      break;
    case "audio":
      attachment = incoming.audio;
      break;
    case "video":
      attachment = incoming.video;
      break;
    case "sticker":
      attachment = incoming.sticker;
      break;
    default:
      return null;
  }
  if (incoming.type !== "text" && attachment === undefined) return malformed();
  const payload = {
    text: incoming.type === "text" ? incoming.text?.body : attachment?.caption,
    attachments: attachment
      ? [
          {
            id: attachment.id,
            mediaType:
              attachment.mime_type ??
              incoming.kapso.media_data?.content_type ??
              "application/octet-stream",
            name: attachment.filename ?? incoming.kapso.media_data?.filename,
          },
        ]
      : [],
    replyToMessageId: incoming.context?.id,
  };
  return await normalizeInbound(coordinates, payload);
};

/** Parses signed v2 body data; webhook event headers never select authority. */
export const parseKapsoWebhook = async function (
  value: unknown,
  configuration: KapsoInstallation,
  nowMs: number
): Promise<InboundEvent[]> {
  const installation = await Promise.try(async () =>
    KapsoInstallationSchema.parseAsync(configuration)
  ).catch(() => {
    return malformed();
  });
  const marker = await Promise.try(async () =>
    z
      .object({
        batch: z.optional(z.boolean()),
      })
      .parseAsync(value)
  ).catch(() => {
    return malformed();
  });
  const items = marker.batch
    ? (
        await Promise.try(async () => batch.parseAsync(value)).catch(() => {
          return malformed();
        })
      ).data
    : [
        await Promise.try(async () => envelope.parseAsync(value)).catch(() => {
          return malformed();
        }),
      ];
  const events = await mapAsync(
    items,
    (item) => normalizeEnvelope(item, installation, nowMs),
    1
  );
  return events.filter((event) => event !== null);
};
function readInstallation() {
  const result = KapsoInstallationSchema.safeParse({
    phoneNumberId: env.KAPSO_PHONE_NUMBER_ID,
    phoneNumber: env.KAPSO_PHONE_NUMBER,
  });
  if (!result.success)
    throw new ProviderInputError({
      provider: "kapso",
      reason: "configuration",
    });
  return result.data;
}
const sendInput = z.object({
  targetId: phone,
  text: z.string().min(1).max(4096),
  reply: z.optional(messageId),
});
const receipt = z.object({
  messaging_product: z.literal("whatsapp"),
  contacts: z
    .array(
      z.object({
        input: phone,
        wa_id: phone,
      })
    )
    .min(1)
    .max(1),
  messages: z
    .array(
      z.object({
        id: messageId,
      })
    )
    .min(1)
    .max(1),
});
const downloadableMedia = z.object({
  id: ProviderReferenceSchema,
  file_size: z.string().regex(/^[0-9]+$/u),
  download_url: z.string().refine((value) => {
    try {
      const url = new URL(value);
      return (
        url.origin === "https://api.kapso.ai" &&
        url.pathname === "/meta/whatsapp/media_download" &&
        !url.username &&
        !url.password &&
        !url.hash &&
        Boolean(url.searchParams.get("token"))
      );
    } catch {
      return false;
    }
  }),
});
const send = async function (
  targetId: string,
  text: string,
  reply?: string,
  confirmation?: {
    token: string;
    purpose: "login" | "link";
  }
) {
  const input = await Promise.try(async () =>
    sendInput.parseAsync({
      targetId,
      text,
      reply,
    })
  ).catch(() => {
    throw new ProviderInputError({
      provider: "kapso",
      reason: "invalid_target",
    });
  });
  const installation = readInstallation();
  const key = await Promise.try(async () => {
    if (!env.KAPSO_API_KEY) throw new Error("Channel is not configured");
    return env.KAPSO_API_KEY;
  }).catch(() => {
    throw new ProviderInputError({
      provider: "kapso",
      reason: "configuration",
    });
  });
  const body: Record<string, unknown> = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: digits(input.targetId),
    type: "text",
    text: {
      body: input.text,
      preview_url: false,
    },
  };
  if (input.reply)
    body.context = {
      message_id: input.reply,
    };
  if (confirmation) {
    body.type = "interactive";
    delete body.text;
    body.interactive = {
      type: "button",
      body: {
        text: input.text,
      },
      action: {
        buttons: [
          {
            type: "reply",
            reply: {
              id: `confirm:${confirmation.token}`,
              title:
                confirmation.purpose === "login"
                  ? "Confirmar entrada"
                  : "Confirmar vínculo",
            },
          },
        ],
      },
    };
  }
  const result = await Promise.try(async () => {
    return await Promise.try(async () =>
      requestProviderJson(
        "kapso",
        `https://api.kapso.ai/meta/whatsapp/v24.0/${installation.phoneNumberId}/messages`,
        {
          method: "POST",
          headers: {
            "X-API-Key": key.reveal(),
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        }
      )
    ).then((value: unknown) => receipt.parseAsync(value));
  }).catch((error: unknown) => {
    if (error instanceof SchemaError)
      return (() => {
        throw new ProviderUncertain({
          provider: "kapso",
          reason: "malformed_receipt",
        });
      })();
    throw error;
  });
  const contact = result.contacts[0];
  const sentMessage = result.messages[0];
  if (
    !contact ||
    !sentMessage ||
    digits(contact.input) !== digits(input.targetId) ||
    digits(contact.wa_id) !== digits(input.targetId)
  ) {
    throw new ProviderUncertain({
      provider: "kapso",
      reason: "malformed_receipt",
    });
  }
  return {
    providerMessageId: sentMessage.id,
  };
};
export const Kapso = {
  downloadMedia: async function (
    installationId: string,
    mediaId: string,
    maxBytes: number
  ) {
    const installation = readInstallation();
    if (installation.phoneNumberId !== installationId)
      throw new ChannelMediaError({
        reason: "wrong_installation",
      });
    const id = await Promise.try(async () => phoneId.parseAsync(mediaId)).catch(
      () => {
        throw new ChannelMediaError({
          reason: "invalid_media",
        });
      }
    );
    const key = await Promise.try(async () => {
      if (!env.KAPSO_API_KEY) throw new Error("Channel is not configured");
      return env.KAPSO_API_KEY;
    }).catch(() => {
      throw new ChannelMediaError({
        reason: "download_failed",
      });
    });
    const metadata = await Promise.try(async () => {
      return await Promise.try(async () =>
        requestProviderJson(
          "kapso",
          `https://api.kapso.ai/meta/whatsapp/v24.0/${id}?phone_number_id=${encodeURIComponent(installationId)}`,
          {
            headers: {
              "X-API-Key": key.reveal(),
            },
          }
        )
      ).then((value: unknown) => downloadableMedia.parseAsync(value));
    }).catch(() => {
      throw new ChannelMediaError({
        reason: "download_failed",
      });
    });
    if (metadata.id !== id)
      throw new ChannelMediaError({
        reason: "invalid_media",
      });
    if (Number(metadata.file_size) > maxBytes)
      throw new ChannelMediaError({
        reason: "too_large",
      });
    // The provider-issued URL embeds its authorization. Never forward the API key.
    const bytes = await downloadMediaBytes(metadata.download_url, maxBytes);
    if (bytes.length !== Number(metadata.file_size))
      throw new ChannelMediaError({
        reason: "invalid_media",
      });
    return bytes;
  },
  parse: async function (value: unknown) {
    return await parseKapsoWebhook(value, readInstallation(), Date.now());
  },
  sendText: (targetId: string, text: string, reply?: string) =>
    send(targetId, text, reply),
  sendLoginConfirmation: async function (
    targetId: string,
    token: string,
    purpose: "login" | "link"
  ) {
    const valid = await Promise.try(async () =>
      LoginTokenSchema.parseAsync(token)
    ).catch(() => {
      return malformed();
    });
    return await send(
      targetId,
      purpose === "login"
        ? "Você pediu para entrar no Zoen? Confirme abaixo. A aba onde você começou vai abrir sua conta. Se não foi você, ignore."
        : "Você pediu para vincular este WhatsApp à sua conta Zoen? Confirme abaixo e volte à aba onde começou. Se não foi você, ignore.",
      undefined,
      {
        token: valid,
        purpose,
      }
    );
  },
};
