import { z } from "zod";

export const channelProviderSchema = z.enum(["telegram", "kapso"]);
const challengeId = z.uuid({ version: "v4" });

export const channelChallengeRequestSchema = z.object({
  channel: channelProviderSchema,
  purpose: z.enum(["login", "link"]),
});

export const channelChallengeSchema = z
  .object({
    id: challengeId,
    channel: channelProviderSchema,
    deepLink: z.string(),
    expiresAt: z.string(),
  })
  .superRefine(({ channel, deepLink, expiresAt }, ctx) => {
    const expectedHost = channel === "telegram" ? "t.me" : "wa.me";
    const prefix = `https://${expectedHost}/`;
    const link = URL.parse(deepLink);
    if (
      !deepLink.startsWith(prefix) ||
      deepLink.includes("\\") ||
      Array.from(deepLink).some(
        (character) =>
          character.charCodeAt(0) < 32 ||
          character.charCodeAt(0) === 127 ||
          /\s/u.test(character)
      ) ||
      link?.protocol !== "https:" ||
      link.hostname !== expectedHost ||
      link.port !== "" ||
      link.username !== "" ||
      link.password !== "" ||
      link.hash !== ""
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["deepLink"],
        message: "Expected a channel-matched HTTPS messenger link.",
      });
      return;
    }
    const expiry = Date.parse(expiresAt);
    if (
      !Number.isFinite(expiry) ||
      new Date(expiry).toISOString() !== expiresAt
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "Expected a finite ISO UTC expiry.",
      });
      return;
    }
    return;
  });

export const channelChallengeIdSchema = z.object({ id: challengeId });

const channelConversationEntrySchema = z.object({
  channel: z.literal("kapso"),
  conversationUrl: z.string().refine((value) => {
    const url = URL.parse(value);
    return (
      url?.protocol === "https:" &&
      url.hostname === "wa.me" &&
      url.port === "" &&
      url.username === "" &&
      url.password === "" &&
      url.hash === "" &&
      /^\/[1-9][0-9]+$/u.test(url.pathname) &&
      !value.includes("\\")
    );
  }),
});

export const channelStartResultSchema = z.union([
  channelChallengeSchema,
  channelConversationEntrySchema,
]);

export const channelChallengeStatusSchema = z.object({
  status: z.enum(["pending", "confirmed", "expired", "consumed"]),
});

export const channelChallengeCompletionSchema = z.object({
  ok: z.literal(true),
});

export const deviceRequestSchema = z.object({
  id: challengeId,
  purpose: channelChallengeRequestSchema.shape.purpose,
});

export const deviceBindingSchema = z.object({
  ...deviceRequestSchema.shape,
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
  archivePreviousAccount: z.optional(z.literal(true)),
});
export const deviceBoundSchema = z.object({
  ...deviceRequestSchema.shape,
  channel: channelProviderSchema,
  expiresAt: z.string(),
});
