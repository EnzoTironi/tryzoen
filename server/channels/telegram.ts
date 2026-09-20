import { ZodError as SchemaError } from "zod";
import { z } from "zod";
import { env } from "@shared/environment/env";
import {
  LoginTokenSchema,
  normalizeInbound,
  ProviderReferenceSchema,
  validateEventAge,
  type InboundCoordinates,
  type InboundEvent,
} from "./inbound";
import {
  detectTelegramChatKind,
  evaluateGroupMentionPolicy,
  telegramTextMentionsBot,
} from "./group-policy";
import {
  boundRetryAfterSeconds,
  ProviderInputError,
  ProviderRejected,
  ProviderRetryable,
  ProviderUncertain,
  requestProviderJson,
} from "./provider-errors";
import { downloadMediaBytes } from "./media/download";
import { ChannelMediaError } from "./media/policy";
const positiveId = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const stringId = z.string().regex(/^[1-9][0-9]{0,15}$/);
const username = z.string().regex(/^@?[A-Za-z][A-Za-z0-9_]{4,31}$/);
export const TelegramInstallationSchema = z.object({
  botId: stringId,
  botUsername: username,
});
export type TelegramInstallation = z.output<typeof TelegramInstallationSchema>;
const user = z.object({
  id: positiveId,
  is_bot: z.boolean(),
});
const file = z.object({
  file_id: ProviderReferenceSchema,
  mime_type: z.optional(ProviderReferenceSchema),
  file_name: z.optional(ProviderReferenceSchema),
});
const messageEntity = z.object({
  type: z.string(),
  offset: z.number().int().min(0),
  length: z.number().int().gt(0),
  user: z.optional(user),
});
const message = z.object({
  message_id: positiveId,
  date: z.number().int().min(0),
  from: z.optional(user),
  chat: z.object({
    id: z.number().int(),
    type: z.string(),
  }),
  text: z.optional(z.string()),
  caption: z.optional(z.string()),
  photo: z.optional(z.array(file).max(20)),
  document: z.optional(file),
  audio: z.optional(file),
  voice: z.optional(file),
  video: z.optional(file),
  sticker: z.optional(file),
  entities: z.optional(z.array(messageEntity).max(100)),
  caption_entities: z.optional(z.array(messageEntity).max(100)),
  reply_to_message: z.optional(
    z.object({
      message_id: positiveId,
      from: z.optional(user),
    })
  ),
});
const callback = z.object({
  id: ProviderReferenceSchema,
  from: user,
  message: z.optional(message),
  data: z.optional(z.string()),
});
const update = z.object({
  update_id: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  message: z.optional(message),
  callback_query: z.optional(callback),
});
function malformed(): never {
  throw new ProviderInputError({
    provider: "telegram",
    reason: "malformed",
  });
}

/** Expects verified JSON. Pure normalization; no credentials or network access. */
export const parseTelegramUpdate = async function (
  value: unknown,
  configuration: TelegramInstallation,
  nowMs: number
): Promise<InboundEvent[]> {
  const installation = await Promise.try(async () =>
    TelegramInstallationSchema.parseAsync(configuration)
  ).catch(() => {
    return malformed();
  });
  const incoming = await Promise.try(async () =>
    update.parseAsync(value)
  ).catch(() => {
    return malformed();
  });
  if (incoming.message && incoming.callback_query) return malformed();
  const source = incoming.callback_query?.message ?? incoming.message;
  const sender = incoming.callback_query?.from ?? incoming.message?.from;
  if (!source || !sender || sender.is_bot) return [];
  if (String(sender.id) === installation.botId) return [];
  const chatKind = detectTelegramChatKind(source.chat.type);
  if (chatKind === "unsupported") return [];
  // Callbacks / login confirmations remain private-only.
  if (incoming.callback_query && chatKind !== "private") return [];
  if (chatKind === "private") {
    if (source.chat.id !== sender.id) return [];
  } else {
    const botUsername = installation.botUsername.replace(/^@/, "");
    const bodyText = source.text ?? source.caption;
    const entities = source.entities ?? source.caption_entities;
    const mentionedBot = telegramTextMentionsBot(
      bodyText,
      botUsername,
      entities,
      installation.botId
    );
    const replyFrom = source.reply_to_message?.from;
    const replyToBot = Boolean(
      replyFrom?.is_bot && String(replyFrom.id) === installation.botId
    );
    if (
      !evaluateGroupMentionPolicy({
        mentionedBot,
        replyToBot,
      })
    )
      return [];
  }
  // A callback is a new click on an older message. Challenge expiry gates auth.
  const occurredAt = await validateEventAge(
    "telegram",
    incoming.callback_query ? nowMs / 1000 : source.date,
    nowMs
  );
  const coordinates: InboundCoordinates = {
    channel: "telegram",
    installationId: installation.botId,
    eventId: String(incoming.update_id),
    senderId: String(sender.id),
    messageId: String(source.message_id),
    occurredAt,
    chatKind,
    chatId: String(source.chat.id),
  };
  const query = incoming.callback_query;
  if (query) {
    if (!source.from?.is_bot || String(source.from.id) !== installation.botId)
      return [];
    if (!query.data?.startsWith("confirm:")) return [];
    if (Buffer.byteLength(query.data, "utf8") > 64) return malformed();
    const token = await LoginTokenSchema.parseAsync(query.data.slice(8)).catch(
      () => {
        throw new ProviderInputError({
          provider: "telegram",
          reason: "invalid_command",
        });
      }
    );
    return [
      {
        ...coordinates,
        kind: "command",
        command: "confirm",
        token,
        callbackQueryId: query.id,
      },
    ];
  }
  const media =
    source.document ??
    source.audio ??
    source.voice ??
    source.video ??
    source.sticker ??
    source.photo?.at(-1);
  const payload = {
    text: source.text ?? source.caption,
    attachments: media
      ? [
          {
            id: media.file_id,
            mediaType: media.mime_type ?? "application/octet-stream",
            name: media.file_name,
          },
        ]
      : [],
    replyToMessageId: source.reply_to_message
      ? String(source.reply_to_message.message_id)
      : undefined,
  };
  const event = await normalizeInbound(
    coordinates,
    payload,
    installation.botUsername.replace(/^@/, "")
  );
  return event ? [event] : [];
};
function readInstallation() {
  const result = TelegramInstallationSchema.safeParse({
    botId: env.TELEGRAM_BOT_ID,
    botUsername: env.TELEGRAM_BOT_USERNAME,
  });
  if (!result.success)
    throw new ProviderInputError({
      provider: "telegram",
      reason: "configuration",
    });
  return result.data;
}
/** Private peers are positive; Telegram groups/supergroups use negative chat ids. */
const chatTargetId = z.string().regex(/^-?[1-9][0-9]{0,15}$/);
const sendInput = z.object({
  targetId: chatTargetId,
  text: z.string().min(1).max(4096),
  reply: z.optional(stringId),
});
const response = z.union([
  z.object({
    ok: z.literal(true),
    result: z.object({
      message_id: positiveId,
      chat: z.object({
        id: z.number().int(),
        type: z.enum(["private", "group", "supergroup"]),
      }),
    }),
  }),
  z.object({
    ok: z.literal(false),
    error_code: z.number().int(),
    parameters: z.optional(
      z.object({
        retry_after: z.optional(z.number()),
      })
    ),
  }),
]);

/** Maps Telegram application-level send failures after a 2xx HTTP envelope. */
export const telegramSendFailure = (failure: {
  error_code: number;
  parameters?: {
    retry_after?: number;
  };
}): ProviderRetryable | ProviderRejected | ProviderUncertain => {
  if (failure.error_code === 429) {
    return new ProviderRetryable({
      provider: "telegram",
      status: 429,
      retryAfterSeconds: boundRetryAfterSeconds(
        failure.parameters?.retry_after
      ),
    });
  }
  if (
    failure.error_code >= 400 &&
    failure.error_code < 500 &&
    failure.error_code !== 408
  ) {
    return new ProviderRejected({
      provider: "telegram",
      status: failure.error_code,
    });
  }
  return new ProviderUncertain({
    provider: "telegram",
    reason: "server_error",
  });
};
const downloadableFile = z.object({
  ok: z.literal(true),
  result: z.object({
    file_id: ProviderReferenceSchema,
    file_size: z.optional(z.number().int().gt(0)),
    file_path: z
      .string()
      .regex(/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/u)
      .refine((path) =>
        path.split("/").every((part) => part !== "." && part !== "..")
      ),
  }),
});
const request = async function (
  method: "sendMessage" | "answerCallbackQuery" | "editMessageText" | "getFile",
  body: unknown
) {
  const installation = readInstallation();
  const secret = await Promise.try(async () => {
    if (!env.TELEGRAM_BOT_TOKEN) throw new Error("Channel is not configured");
    return env.TELEGRAM_BOT_TOKEN;
  }).catch(() => {
    throw new ProviderInputError({
      provider: "telegram",
      reason: "configuration",
    });
  });
  const token = secret.reveal();
  await Promise.try(async () =>
    z
      .string()
      .regex(/^[1-9][0-9]*:[A-Za-z0-9_-]+$/)
      .parseAsync(token)
  ).catch(() => {
    throw new ProviderInputError({
      provider: "telegram",
      reason: "configuration",
    });
  });
  if (token.split(":")[0] !== installation.botId) {
    throw new ProviderInputError({
      provider: "telegram",
      reason: "configuration",
    });
  }
  return await requestProviderJson(
    "telegram",
    `https://api.telegram.org/bot${token}/${method}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );
};
const send = async function (
  targetId: string,
  text: string,
  reply?: string,
  confirmation?: {
    data: string;
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
      provider: "telegram",
      reason: "invalid_target",
    });
  });
  const body: Record<string, unknown> = {
    chat_id: input.targetId,
    text: input.text,
    link_preview_options: {
      is_disabled: true,
    },
  };
  if (input.reply)
    body.reply_parameters = {
      message_id: Number(input.reply),
      allow_sending_without_reply: false,
    };
  if (confirmation)
    body.reply_markup = {
      inline_keyboard: [
        [
          {
            text:
              confirmation.purpose === "login"
                ? "Confirm sign-in"
                : "Confirm account link",
            callback_data: confirmation.data,
          },
        ],
      ],
    };
  const result = await Promise.try(async () => {
    return await Promise.try(async () => request("sendMessage", body)).then(
      (value: unknown) => response.parseAsync(value)
    );
  }).catch((error: unknown) => {
    if (error instanceof SchemaError)
      return (() => {
        throw new ProviderUncertain({
          provider: "telegram",
          reason: "malformed_receipt",
        });
      })();
    throw error;
  });
  if (!result.ok) {
    throw telegramSendFailure(result);
  }
  if (String(result.result.chat.id) !== input.targetId) {
    throw new ProviderUncertain({
      provider: "telegram",
      reason: "malformed_receipt",
    });
  }
  return {
    providerMessageId: String(result.result.message_id),
  };
};
export const Telegram = {
  downloadMedia: async function (
    installationId: string,
    fileId: string,
    maxBytes: number
  ) {
    const installation = readInstallation();
    if (installation.botId !== installationId)
      throw new ChannelMediaError({
        reason: "wrong_installation",
      });
    const id = await Promise.try(async () =>
      ProviderReferenceSchema.parseAsync(fileId)
    ).catch(() => {
      throw new ChannelMediaError({
        reason: "invalid_media",
      });
    });
    const metadata = await Promise.try(async () => {
      return await Promise.try(async () =>
        request("getFile", {
          file_id: id,
        })
      ).then((value: unknown) => downloadableFile.parseAsync(value));
    }).catch(() => {
      throw new ChannelMediaError({
        reason: "download_failed",
      });
    });
    if (metadata.result.file_id !== id)
      throw new ChannelMediaError({
        reason: "invalid_media",
      });
    if (
      metadata.result.file_size !== undefined &&
      metadata.result.file_size > maxBytes
    )
      throw new ChannelMediaError({
        reason: "too_large",
      });
    const secret = await Promise.try(async () => {
      if (!env.TELEGRAM_BOT_TOKEN) throw new Error("Channel is not configured");
      return env.TELEGRAM_BOT_TOKEN;
    }).catch(() => {
      throw new ChannelMediaError({
        reason: "download_failed",
      });
    });
    const bytes = await downloadMediaBytes(
      `https://api.telegram.org/file/bot${secret.reveal()}/${metadata.result.file_path}`,
      maxBytes
    );
    if (
      metadata.result.file_size !== undefined &&
      bytes.length !== metadata.result.file_size
    )
      throw new ChannelMediaError({
        reason: "invalid_media",
      });
    return bytes;
  },
  parse: async function (value: unknown) {
    return await parseTelegramUpdate(value, readInstallation(), Date.now());
  },
  sendText: async function (targetId: string, text: string, reply?: string) {
    return await send(targetId, text, reply);
  },
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
    const data = `confirm:${valid}`;
    if (Buffer.byteLength(data, "utf8") > 64) return malformed();
    return await send(
      targetId,
      purpose === "login"
        ? "Confirm this sign-in only if you requested it in your Zoen browser tab. Then return to that tab to finish signing in."
        : "Confirm linking this Telegram account only if you requested it in your Zoen browser tab. Then return to that tab to finish linking.",
      undefined,
      {
        data,
        purpose,
      }
    );
  },
  editLoginConfirmation: async function (targetId: string, messageId: string) {
    const input = await Promise.try(async () =>
      z
        .object({
          targetId: stringId,
          messageId: stringId,
        })
        .parseAsync({
          targetId,
          messageId,
        })
    ).catch(() => {
      return malformed();
    });
    const result = await Promise.try(async () => {
      return await Promise.try(async () =>
        request("editMessageText", {
          chat_id: input.targetId,
          message_id: Number(input.messageId),
          text: "Confirmed. Return to the Zoen browser tab where you started this request and finish there. You can close this Telegram chat.",
          reply_markup: {
            inline_keyboard: [],
          },
        })
      ).then((value: unknown) => response.parseAsync(value));
    }).catch((error: unknown) => {
      if (error instanceof SchemaError)
        return (() => {
          throw new ProviderUncertain({
            provider: "telegram",
            reason: "malformed_receipt",
          });
        })();
      throw error;
    });
    if (!result.ok) throw telegramSendFailure(result);
    if (
      String(result.result.chat.id) !== input.targetId ||
      String(result.result.message_id) !== input.messageId
    ) {
      throw new ProviderUncertain({
        provider: "telegram",
        reason: "malformed_receipt",
      });
    }
    return undefined;
  },
  answerCallbackQuery: async function (
    callbackQueryId: string,
    text: string,
    showAlert: boolean
  ) {
    const input = await Promise.try(async () =>
      z
        .object({
          callbackQueryId: ProviderReferenceSchema,
          text: z.string().min(1).max(200),
          showAlert: z.boolean(),
        })
        .parseAsync({
          callbackQueryId,
          text,
          showAlert,
        })
    ).catch(() => {
      return malformed();
    });
    const body = await request("answerCallbackQuery", {
      callback_query_id: input.callbackQueryId,
      text: input.text,
      show_alert: input.showAlert,
    });
    await Promise.try(async () =>
      z
        .object({
          ok: z.literal(true),
          result: z.literal(true),
        })
        .parseAsync(body)
    ).catch(() => {
      throw new ProviderUncertain({
        provider: "telegram",
        reason: "malformed_receipt",
      });
    });
  },
};
