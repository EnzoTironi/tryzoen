import { z } from "zod";
import { creatorPilotInviteSchema } from "../creators/schema";

// Unicode mode consumes valid surrogate pairs as one code point. Only lone
// surrogates match this range, including on ES2022/native engines.
const wellFormedText = z
  .string()
  .refine(
    (text) => !/[\uD800-\uDFFF]/u.test(text),
    "Text must be well-formed Unicode."
  );

/** Presentation validation only. Eve owns approval and current authority. */
export const approvalTextSchema = wellFormedText
  .min(1)
  .max(16_384)
  .refine(
    (text) => text.trim().length > 0,
    "Approval details must be complete, non-empty, well-formed text."
  );

const emailAddress = z
  .string()
  .refine(
    (value) => z.email().safeParse(value).success,
    "Invalid email address"
  );
const mailHeader = wellFormedText
  .min(1)
  .max(998)
  .refine(
    (value) =>
      value === value.trim() &&
      Array.from(value).every(
        (character) =>
          character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127
      ),
    "Mail headers must be well-formed, trimmed text without line breaks"
  );

export const gmailSendSchema = z.object({
  bcc: z.array(emailAddress).max(20).default([]),
  body: wellFormedText.min(1).max(100_000),
  cc: z.array(emailAddress).max(20).default([]),
  inReplyTo: mailHeader.optional(),
  subject: mailHeader,
  threadId: z.string().min(1).max(200).optional(),
  to: z.array(emailAddress).min(1).max(20),
});

/** The exact bot identity and publication selected for this action. */
export const NetworkDestinationSchema = z.strictObject({
  botId: z.uuid(),
  workspaceId: z
    .string()
    .min(1)
    .max(200)
    .refine((value) => value === value.trim(), "Expected trimmed text"),
  revision: z.string().regex(/^[a-f0-9]{64}$/u),
});
const networkContactPayloadSchema = z.strictObject({
  // People and bots use the same existing public handle rule.
  username: creatorPilotInviteSchema.shape.username,
  destination: NetworkDestinationSchema,
  text: wellFormedText
    .min(1)
    .max(8000)
    .refine(
      (value) => value === value.trim(),
      "Expected trimmed, well-formed text"
    ),
});

function disclose(title: string, payload: unknown, supplementary?: unknown) {
  return approvalTextSchema.parse(
    `${title} — exact payload\n${JSON.stringify(payload, null, 2)}` +
      (supplementary === undefined
        ? ""
        : `\n\nSupplementary context (does not change the payload):\n${approvalTextSchema.parse(supplementary)}`)
  );
}

export function renderGmailApproval(raw: unknown, supplementary?: unknown) {
  return disclose("Gmail email", gmailSendSchema.parse(raw), supplementary);
}

export const gmailSendInputSchema = gmailSendSchema
  .extend({
    approvalMessage: approvalTextSchema.describe(
      "Supplementary context for the exact email payload. It cannot replace or change the recipients, subject, full body or thread/reply fields shown by native approval."
    ),
  })
  .refine((input) => {
    try {
      renderGmailApproval(input, input.approvalMessage);
      return true;
    } catch {
      return false;
    }
  }, "Complete email approval exceeds the presentation limit or contains invalid text. Propose a smaller email; do not omit content.");

/** Validates material fields only. The caller supplies supplementary context
 * separately; native network input has no supplementary field. */
export function renderNetworkApproval(raw: unknown, supplementary?: unknown) {
  return disclose(
    "Network contact",
    networkContactPayloadSchema.parse(raw),
    supplementary
  );
}

export const NetworkContactInputSchema = networkContactPayloadSchema.refine(
  (input) => {
    try {
      renderNetworkApproval(input);
      return true;
    } catch {
      return false;
    }
  },
  "The complete recipient and payload must fit the approval display. Use a smaller message; no content may be omitted."
);

export const CommunityDestinationSchema = z.strictObject({
  workspaceId: wellFormedText.min(1).max(200),
  channelId: z.uuid(),
  roomId: wellFormedText.min(1).max(256),
  communityName: wellFormedText.min(1).max(200),
  channelName: wellFormedText.min(1).max(200),
  revision: z.string().regex(/^[a-f0-9]{64}$/u),
});
const communityContributionPayloadSchema = z.strictObject({
  destination: CommunityDestinationSchema,
  purpose: wellFormedText.min(1).max(1000),
  text: wellFormedText.min(1).max(8000),
  operationId: z.uuid(),
});

export function renderCommunityContributionApproval(raw: unknown) {
  return disclose(
    "Share with community — only the message text is published",
    communityContributionPayloadSchema.parse(raw)
  );
}

export const CommunityContributionInputSchema =
  communityContributionPayloadSchema.refine((input) => {
    try {
      renderCommunityContributionApproval(input);
      return input.text.trim().length > 0 && input.purpose.trim().length > 0;
    } catch {
      return false;
    }
  }, "The exact purpose, channel and full message must fit the approval display. Use a smaller message; no content may be omitted.");

/** Invalid known actions are distinct from unsupported actions. An invalid result
 * must disable approval; it must never select generic or summary-only fallback. */
export function renderApprovalDisclosure(toolName: string, input: unknown) {
  if (
    toolName !== "gmail-send" &&
    toolName !== "network-contact" &&
    toolName !== "community-contribute"
  )
    return { kind: "unsupported" } as const;
  try {
    let text: string;
    if (toolName === "gmail-send") {
      const payload = gmailSendInputSchema.parse(input);
      text = renderGmailApproval(payload, payload.approvalMessage);
    } else if (toolName === "network-contact") {
      text = renderNetworkApproval(NetworkContactInputSchema.parse(input));
    } else {
      text = renderCommunityContributionApproval(
        CommunityContributionInputSchema.parse(input)
      );
    }
    return { kind: "ready", text } as const;
  } catch {
    return {
      kind: "invalid",
      message:
        "Complete approval details are invalid or exceed 16384 characters. Review a smaller exact action before approving.",
    } as const;
  }
}
